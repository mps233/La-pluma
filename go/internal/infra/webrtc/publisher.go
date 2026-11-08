// Package webrtc publishes the scrcpy H.264 stream to browser peers and
// accepts input on a WebRTC data channel. It does not use ScrcpyOverWebRTC.
package webrtc

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"

	"github.com/mps233/la-pluma/go/internal/infra/scrcpy"
)

type TouchMessage struct {
	Type       string  `json:"type"`
	ID         uint64  `json:"id"`
	Sequence   uint64  `json:"seq"`
	ClientTSMS int64   `json:"client_ts_ms"`
	Action     int     `json:"action"`
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	Width      float64 `json:"w"`
	Height     float64 `json:"h"`
	HScroll    float64 `json:"hscroll"`
	VScroll    float64 `json:"vscroll"`
	Buttons    int     `json:"buttons"`
}

type Publisher struct {
	mu      sync.RWMutex
	peers   map[string]*peer
	video   *webrtc.TrackLocalStaticSample
	session *scrcpy.Session
	logger  *slog.Logger
	stop    chan struct{}
	closed  sync.Once
	onPeer  func(connected bool)
	onEnded func()
	ended   sync.Once

	cacheMu      sync.Mutex
	lastConfig   []byte
	lastKeyframe []byte
	profileLevel string
}

type peer struct {
	pc      *webrtc.PeerConnection
	input   *webrtc.DataChannel
	pending []webrtc.ICECandidateInit
	answer  bool
	mu      sync.Mutex
}

func New(session *scrcpy.Session, logger *slog.Logger) (*Publisher, error) {
	if logger == nil {
		logger = slog.Default()
	}
	track, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{
			MimeType:    webrtc.MimeTypeH264,
			ClockRate:   90000,
			SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f",
		},
		"video", "scrcpy-video",
	)
	if err != nil {
		return nil, fmt.Errorf("create video track: %w", err)
	}
	return &Publisher{
		peers:   make(map[string]*peer),
		video:   track,
		session: session,
		logger:  logger,
		stop:    make(chan struct{}),
	}, nil
}

// SetPeerStateListener observes peer connect/disconnect for viewer counts.
func (p *Publisher) SetPeerStateListener(listener func(connected bool)) {
	p.mu.Lock()
	p.onPeer = listener
	p.mu.Unlock()
}

// CreateOffer builds an offer, waits for ICE gathering to complete, and
// returns the local SDP plus the gathered candidates.
func (p *Publisher) CreateOffer(peerID string) (string, []webrtc.ICECandidateInit, error) {
	mediaEngine := &webrtc.MediaEngine{}
	if err := mediaEngine.RegisterDefaultCodecs(); err != nil {
		return "", nil, err
	}
	settingEngine := webrtc.SettingEngine{}

	api := webrtc.NewAPI(webrtc.WithMediaEngine(mediaEngine), webrtc.WithSettingEngine(settingEngine))
	pc, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		return "", nil, fmt.Errorf("create peer connection: %w", err)
	}
	if _, err := pc.AddTrack(p.video); err != nil {
		pc.Close()
		return "", nil, fmt.Errorf("add video track: %w", err)
	}
	input, err := pc.CreateDataChannel("input-channel", nil)
	if err != nil {
		pc.Close()
		return "", nil, fmt.Errorf("create input channel: %w", err)
	}
	input.OnOpen(func() {
		p.logger.Info("input channel open", "peer", peerID)
	})
	input.OnClose(func() {
		p.logger.Info("input channel closed", "peer", peerID)
	})
	input.OnMessage(func(message webrtc.DataChannelMessage) {
		p.handleInput(message.Data)
	})

	var candidates []webrtc.ICECandidateInit
	var candidateMu sync.Mutex
	pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		candidateMu.Lock()
		candidates = append(candidates, candidate.ToJSON())
		candidateMu.Unlock()
	})
	pc.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		p.logger.Debug("ice state", "peer", peerID, "state", state)
	})
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		p.logger.Debug("peer state", "peer", peerID, "state", state)
		switch state {
		case webrtc.PeerConnectionStateConnected:
			p.notifyPeer(true)
			p.writeCachedKeyframe()
		case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed, webrtc.PeerConnectionStateDisconnected:
			p.RemovePeer(peerID)
			p.notifyPeer(false)
		}
	})

	offer, err := pc.CreateOffer(nil)
	if err != nil {
		pc.Close()
		return "", nil, fmt.Errorf("create offer: %w", err)
	}
	if err := pc.SetLocalDescription(offer); err != nil {
		pc.Close()
		return "", nil, fmt.Errorf("set local description: %w", err)
	}
	<-webrtc.GatheringCompletePromise(pc)
	candidateMu.Lock()
	gathered := append([]webrtc.ICECandidateInit(nil), candidates...)
	candidateMu.Unlock()

	p.mu.Lock()
	p.peers[peerID] = &peer{pc: pc, input: input}
	p.mu.Unlock()

	return p.applyProfileLevel(pc.LocalDescription().SDP), gathered, nil
}

func (p *Publisher) SetAnswer(peerID, sdp string) error {
	p.mu.RLock()
	entry := p.peers[peerID]
	p.mu.RUnlock()
	if entry == nil {
		return fmt.Errorf("unknown peer %s", peerID)
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if err := entry.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: sdp}); err != nil {
		return fmt.Errorf("set remote answer: %w", err)
	}
	entry.answer = true
	for _, candidate := range entry.pending {
		_ = entry.pc.AddICECandidate(candidate)
	}
	entry.pending = nil
	return nil
}

func (p *Publisher) AddICECandidate(peerID string, candidate webrtc.ICECandidateInit) error {
	p.logger.Debug("remote candidate", "peer", peerID, "summary", candidateSummary(candidate.Candidate))
	p.mu.RLock()
	entry := p.peers[peerID]
	p.mu.RUnlock()
	if entry == nil {
		return fmt.Errorf("unknown peer %s", peerID)
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if !entry.answer {
		entry.pending = append(entry.pending, candidate)
		return nil
	}
	return entry.pc.AddICECandidate(candidate)
}

func (p *Publisher) RemovePeer(peerID string) {
	p.logger.Debug("remove peer", "peer", peerID)
	p.mu.Lock()
	entry := p.peers[peerID]
	delete(p.peers, peerID)
	p.mu.Unlock()
	if entry != nil {
		entry.pc.Close()
	}
}

func (p *Publisher) PeerCount() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return len(p.peers)
}

// SetOnEnded installs a callback for a terminal video-read error.
func (p *Publisher) SetOnEnded(fn func()) {
	p.mu.Lock()
	p.onEnded = fn
	p.mu.Unlock()
}

func (p *Publisher) notifyEnded() {
	p.ended.Do(func() {
		p.mu.RLock()
		fn := p.onEnded
		p.mu.RUnlock()
		if fn != nil {
			fn()
		}
	})
}

func (p *Publisher) notifyPeer(connected bool) {
	p.mu.RLock()
	listener := p.onPeer
	p.mu.RUnlock()
	if listener != nil {
		listener(connected)
	}
}

func (p *Publisher) handleInput(data []byte) {
	var message TouchMessage
	if err := json.Unmarshal(data, &message); err != nil {
		return
	}
	width := uint16(message.Width)
	height := uint16(message.Height)
	if width == 0 {
		width = uint16(p.session.Width)
	}
	if height == 0 {
		height = uint16(p.session.Height)
	}
	switch message.Type {
	case "touch":
		pressure := float32(1)
		if message.Action == scrcpy.TouchActionUp || message.Action == scrcpy.TouchActionCancel {
			pressure = 0
		}
		p.logger.Info("touch input", "action", message.Action, "id", message.ID, "x", message.X, "y", message.Y, "w", width, "h", height)
		if err := p.session.SendTouch(message.Action, message.ID, int32(message.X), int32(message.Y), width, height, pressure); err != nil {
			p.logger.Warn("touch input failed", "error", err)
		}
	case "scroll":
		p.logger.Info("scroll input", "x", message.X, "y", message.Y, "h", message.HScroll, "v", message.VScroll)
		if err := p.session.SendScroll(int32(message.X), int32(message.Y), width, height, float32(message.HScroll), float32(message.VScroll), message.Buttons); err != nil {
			p.logger.Warn("scroll input failed", "error", err)
		}
	}
}

// FeedVideo reads scrcpy packets and writes H.264 samples to the WebRTC track.
// Config packets (SPS/PPS) are prepended to keyframes so the browser can
// decode from the first packet.
func (p *Publisher) FeedVideo() {
	var configData []byte
	var lastPTS uint64
	packetCount := 0
	var lastPacket atomic.Int64
	go p.watchVideo(&lastPacket)
	for {
		select {
		case <-p.stop:
			return
		default:
		}
		header, data, err := p.session.ReadVideoPacket()
		if err != nil {
			p.logger.Warn("scrcpy video ended", "error", err)
			p.notifyEnded()
			return
		}
		lastPacket.Store(time.Now().UnixNano())
		if header.IsConfig() {
			configData = append([]byte(nil), data...)
			profileLevel := spsProfileLevelID(data)
			p.cacheMu.Lock()
			p.lastConfig = append([]byte(nil), data...)
			p.profileLevel = profileLevel
			p.cacheMu.Unlock()
			p.logger.Info("video config", "bytes", len(data), "nals", nalTypes(data), "profile_level_id", profileLevel)
			continue
		}
		sample := data
		if header.IsKeyFrame() && len(configData) > 0 {
			combined := make([]byte, 0, len(configData)+len(data))
			combined = append(combined, configData...)
			combined = append(combined, data...)
			sample = combined
		}
		if header.IsKeyFrame() {
			p.cacheMu.Lock()
			p.lastKeyframe = append([]byte(nil), sample...)
			p.cacheMu.Unlock()
			p.logger.Debug("video keyframe", "bytes", len(sample), "config_bytes", len(configData), "nals", nalTypes(sample))
		}
		pts := header.PTS()
		duration := 33 * time.Millisecond
		if lastPTS > 0 && pts > lastPTS {
			duration = time.Duration(pts-lastPTS) * time.Microsecond
		}
		lastPTS = pts
		if duration < time.Millisecond {
			duration = time.Millisecond
		}
		if duration > 500*time.Millisecond {
			duration = 500 * time.Millisecond
		}
		if err := p.video.WriteSample(media.Sample{Data: sample, Duration: duration}); err != nil {
			p.logger.Warn("write video sample", "error", err)
			return
		}
		packetCount++
		if packetCount <= 3 || packetCount%1000 == 0 {
			p.logger.Info("video sample", "packet", packetCount, "bytes", len(sample), "duration", duration)
		}
	}
}

// writeCachedKeyframe gives a newly connected peer a decodable starting point.
// scrcpy does not necessarily emit periodic keyframes, so a peer that joins
// after the initial frame would otherwise stay black until the next one.
func (p *Publisher) writeCachedKeyframe() {
	p.cacheMu.Lock()
	sample := append([]byte(nil), p.lastKeyframe...)
	p.cacheMu.Unlock()
	if len(sample) == 0 {
		return
	}
	if err := p.video.WriteSample(media.Sample{Data: sample, Duration: 33 * time.Millisecond}); err != nil {
		p.logger.Warn("write cached keyframe", "error", err)
	} else {
		p.logger.Info("sent cached keyframe", "bytes", len(sample))
	}
}

func (p *Publisher) Close() {
	p.closed.Do(func() { close(p.stop) })
	p.mu.Lock()
	peers := p.peers
	p.peers = make(map[string]*peer)
	p.mu.Unlock()
	for _, entry := range peers {
		entry.pc.Close()
	}
}
func (p *Publisher) SessionWidth() int  { return p.session.Width }
func (p *Publisher) SessionHeight() int { return p.session.Height }

func (p *Publisher) SendKeyTap(keycode int) error { return p.session.SendKeyTap(keycode) }
func (p *Publisher) SendText(text string) error   { return p.session.SendText(text) }

// nalTypes reports the H.264 NAL unit types in an Annex-B access unit. It is
// diagnostic: WebKit is sensitive to missing access-unit delimiters and to
// oversized keyframes, and both are visible here.
func nalTypes(data []byte) []int {
	types := make([]int, 0, 8)
	for index := 0; index+3 < len(data); {
		if data[index] != 0 || data[index+1] != 0 {
			index++
			continue
		}
		if data[index+2] == 1 {
			types = append(types, int(data[index+3]&0x1f))
			index += 4
			continue
		}
		if data[index+2] == 0 && data[index+3] == 1 && index+4 < len(data) {
			types = append(types, int(data[index+4]&0x1f))
			index += 5
			continue
		}
		index++
	}
	return types
}

// applyProfileLevel replaces the hardcoded baseline/3.1 fmtp with the SPS's
// real profile-level-id. WebKit configures its H.264 decoder from this value,
// so advertising a lower level than the encoder emits can drop frames.
func (p *Publisher) applyProfileLevel(sdp string) string {
	p.cacheMu.Lock()
	profileLevel := p.profileLevel
	p.cacheMu.Unlock()
	if profileLevel == "" {
		return sdp
	}
	return strings.ReplaceAll(sdp, "profile-level-id=42001f", "profile-level-id="+profileLevel)
}

// spsProfileLevelID returns profile_idc, constraint flags and level_idc from
// the SPS NAL as the six hex digits used by SDP fmtp.
func spsProfileLevelID(data []byte) string {
	for index := 0; index+3 < len(data); index++ {
		if data[index] != 0 || data[index+1] != 0 {
			continue
		}
		var nalStart int
		if data[index+2] == 1 {
			nalStart = index + 3
		} else if data[index+2] == 0 && data[index+3] == 1 {
			nalStart = index + 4
		} else {
			continue
		}
		if nalStart+3 >= len(data) || data[nalStart]&0x1f != 7 {
			continue
		}
		return fmt.Sprintf("%02x%02x%02x", data[nalStart+1], data[nalStart+2], data[nalStart+3])
	}
	return ""
}

func candidateSummary(candidate string) string {
	fields := strings.Fields(strings.TrimPrefix(candidate, "candidate:"))
	if len(fields) < 8 || fields[6] != "typ" {
		return "invalid"
	}
	address := fields[4]
	loopback := strings.HasPrefix(address, "127.") || address == "::1"
	return "typ=" + fields[7] + " loopback=" + fmt.Sprintf("%t", loopback) + " protocol=" + fields[2]
}

// watchVideo recovers a capture/encoder stall: scrcpy normally emits frames
// continuously, so a multi-second gap means the stream is stuck. RESET_VIDEO
// asks the server to restart capture and send a fresh keyframe.
func (p *Publisher) watchVideo(lastPacket *atomic.Int64) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	resets := 0
	var lastReset time.Time
	for {
		select {
		case <-p.stop:
			return
		case now := <-ticker.C:
			last := lastPacket.Load()
			if last == 0 {
				continue
			}
			idle := now.Sub(time.Unix(0, last))
			if idle < 10*time.Second {
				if resets > 0 {
					p.logger.Info("video recovered after capture reset")
				}
				resets = 0
				lastReset = time.Time{}
				continue
			}
			if !lastReset.IsZero() && now.Sub(lastReset) < 30*time.Second {
				continue
			}
			if err := p.session.ResetVideo(); err != nil {
				p.logger.Warn("video reset failed", "error", err)
				continue
			}
			lastReset = now
			resets++
			p.logger.Warn("video stalled; reset capture", "idle", idle.String(), "attempt", resets)
		}
	}
}
