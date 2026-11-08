package signaling

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"

	scwebrtc "github.com/mps233/la-pluma/go/internal/infra/webrtc"
	"github.com/mps233/la-pluma/go/internal/transport/httpx"
)

const (
	ticketTTL    = 15 * time.Second
	maxTickets   = 256
	writeTimeout = 10 * time.Second
)

type Server struct {
	provider func() *scwebrtc.Publisher
	logger   *slog.Logger
	deviceID string

	mu      sync.Mutex
	tickets map[string]time.Time

	iceMu       sync.RWMutex
	iceProvider func() []any

	viewerMu sync.Mutex
	viewers  int
}

func New(provider func() *scwebrtc.Publisher, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	if provider == nil {
		provider = func() *scwebrtc.Publisher { return nil }
	}
	return &Server{
		provider: provider,
		logger:   logger,
		tickets:  make(map[string]time.Time),
	}
}

// SetICEServers installs the ICE server list advertised in the config message.
func (s *Server) SetICEServers(provider func() []any) {
	s.iceMu.Lock()
	s.iceProvider = provider
	s.iceMu.Unlock()
}

func (s *Server) iceServers() []any {
	s.iceMu.RLock()
	provider := s.iceProvider
	s.iceMu.RUnlock()
	if provider == nil {
		return []any{}
	}
	return provider()
}

func (s *Server) publisher() *scwebrtc.Publisher {
	if s.provider == nil {
		return nil
	}
	return s.provider()
}

// Handler serves the paths the React client expects under /webrtc-signaling.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/login", s.Login)
	mux.HandleFunc("GET /connect_client", s.Connect)
	return mux
}

func (s *Server) Login(w http.ResponseWriter, r *http.Request) {
	if s.publisher() == nil {
		httpx.Failure(w, http.StatusServiceUnavailable, &httpx.APIError{Code: "WEBRTC_NOT_READY", Message: "WebRTC 服务尚未启动", Retryable: true})
		return
	}
	token, err := randomToken()
	if err != nil {
		httpx.Failure(w, http.StatusServiceUnavailable, &httpx.APIError{Code: "WEBRTC_TICKET_FAILED", Message: "无法创建信令票据", Retryable: true})
		return
	}
	now := time.Now()
	s.mu.Lock()
	for ticket, expiry := range s.tickets {
		if now.After(expiry) {
			delete(s.tickets, ticket)
		}
	}
	for len(s.tickets) >= maxTickets {
		var oldest string
		var oldestExpiry time.Time
		for ticket, expiry := range s.tickets {
			if oldest == "" || expiry.Before(oldestExpiry) {
				oldest, oldestExpiry = ticket, expiry
			}
		}
		delete(s.tickets, oldest)
	}
	s.tickets[token] = now.Add(ticketTTL)
	s.mu.Unlock()

	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"token": token, "expiresInMs": ticketTTL.Milliseconds()})
}

func (s *Server) Connect(w http.ResponseWriter, r *http.Request) {
	if s.publisher() == nil {
		http.Error(w, "WebRTC service is not running", http.StatusServiceUnavailable)
		return
	}
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if token == "" || !s.consumeTicket(token) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	upgrader := websocket.Upgrader{
		ReadBufferSize:  64 * 1024,
		WriteBufferSize: 64 * 1024,
		CheckOrigin:     func(*http.Request) bool { return true },
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.logger.Warn("signaling upgrade", "error", err)
		return
	}
	peerID, err := randomToken()
	if err != nil {
		_ = conn.Close()
		return
	}
	client := &wsClient{conn: conn, server: s, peerID: peerID}
	defer client.close()
	s.addViewer()
	defer s.removeViewer()

	client.writeJSON(map[string]any{"type": "config", "ice_servers": s.iceServers()})

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var message map[string]any
		if err := json.Unmarshal(data, &message); err != nil {
			client.sendError("无效的信令消息")
			continue
		}
		messageType, _ := message["message_type"].(string)
		if messageType == "" {
			messageType, _ = message["type"].(string)
		}
		switch messageType {
		case "connect":
			continue
		case "ping":
			client.writeJSON(map[string]any{"type": "pong"})
		case "forward":
			payload, _ := message["payload"].(map[string]any)
			if err := client.forward(payload); err != nil {
				client.sendError(err.Error())
			}
		case "command":
			client.handleCommand(message)
		}
	}
}

func (s *Server) SetDeviceID(deviceID string) {
	s.mu.Lock()
	s.deviceID = deviceID
	s.mu.Unlock()
}

func (s *Server) ViewerCount() int {
	s.viewerMu.Lock()
	defer s.viewerMu.Unlock()
	return s.viewers
}

func (s *Server) addViewer() {
	s.viewerMu.Lock()
	s.viewers++
	s.viewerMu.Unlock()
}

func (s *Server) removeViewer() {
	s.viewerMu.Lock()
	if s.viewers > 0 {
		s.viewers--
	}
	s.viewerMu.Unlock()
}

func (s *Server) consumeTicket(token string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	expiry, ok := s.tickets[token]
	if !ok {
		return false
	}
	delete(s.tickets, token)
	return time.Now().Before(expiry)
}

type wsClient struct {
	conn   *websocket.Conn
	server *Server
	peerID string
	mu     sync.Mutex
	closed sync.Once
}

func (c *wsClient) close() {
	c.closed.Do(func() {
		if publisher := c.server.publisher(); publisher != nil {
			publisher.RemovePeer(c.peerID)
		}
		_ = c.conn.Close()
	})
}

func (c *wsClient) writeJSON(value any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	if err := c.conn.WriteJSON(value); err != nil {
		c.server.logger.Info("signaling write failed", "error", err)
	}
}

func (c *wsClient) sendPayload(payload map[string]any) {
	c.writeJSON(map[string]any{"message_type": "device_msg", "payload": payload})
}

func (c *wsClient) sendError(message string) {
	c.sendPayload(map[string]any{"type": "scrcpy_error", "message": message})
}

func (c *wsClient) forward(payload map[string]any) error {
	if payload == nil {
		return fmt.Errorf("缺少信令 payload")
	}
	payloadType, _ := payload["type"].(string)
	publisher := c.server.publisher()
	if publisher == nil {
		return fmt.Errorf("WebRTC 服务尚未启动")
	}
	switch payloadType {
	case "request-offer":
		c.server.logger.Info("signaling request-offer", "peer", c.peerID)
		display := map[string]any{
			"x_res": publisher.SessionWidth(),
			"y_res": publisher.SessionHeight(),
		}
		c.writeJSON(map[string]any{
			"type":        "device_info",
			"device_info": map[string]any{"displays": []any{display}},
		})
		sdp, candidates, err := publisher.CreateOffer(c.peerID)
		c.server.logger.Info("signaling offer", "peer", c.peerID, "sdp_len", len(sdp), "candidates", len(candidates), "error", err)
		if err != nil {
			return fmt.Errorf("创建 WebRTC offer 失败: %w", err)
		}
		c.sendPayload(map[string]any{"type": "offer", "sdp": sdp})
		for _, candidate := range candidates {
			c.sendPayload(map[string]any{"type": "ice-candidate", "candidate": candidate})
		}
		return nil
	case "answer":
		sdp, _ := payload["sdp"].(string)
		if sdp == "" {
			return fmt.Errorf("缺少 SDP answer")
		}
		return publisher.SetAnswer(c.peerID, sdp)
	case "ice-candidate":
		raw, ok := payload["candidate"].(map[string]any)
		if !ok {
			return nil
		}
		candidate := webrtc.ICECandidateInit{}
		if value, ok := raw["candidate"].(string); ok {
			candidate.Candidate = value
		}
		if value, ok := raw["sdpMid"].(string); ok {
			candidate.SDPMid = &value
		}
		if value, ok := raw["sdpMLineIndex"].(float64); ok {
			index := uint16(value)
			candidate.SDPMLineIndex = &index
		}
		return publisher.AddICECandidate(c.peerID, candidate)
	default:
		return fmt.Errorf("不支持的信令类型: %s", payloadType)
	}
}

func (c *wsClient) handleCommand(message map[string]any) {
	requestID, _ := message["request_id"].(string)
	command, _ := message["command"].(string)
	success := true
	output := ""
	if err := c.server.handleCommand(command); err != nil {
		success = false
		output = err.Error()
	}
	c.sendPayload(map[string]any{
		"type":       "command_result",
		"request_id": requestID,
		"success":    success,
		"output":     output,
	})
}

func (s *Server) handleCommand(command string) error {
	parts := strings.Fields(strings.TrimSpace(command))
	if len(parts) == 0 {
		return fmt.Errorf("命令为空")
	}
	if len(parts) >= 3 && parts[0] == "input" && parts[1] == "keyevent" {
		keycode, err := strconv.Atoi(parts[2])
		if err != nil {
			return fmt.Errorf("无效的 keyevent: %s", parts[2])
		}
		publisher := s.publisher()
		if publisher == nil {
			return fmt.Errorf("WebRTC 服务尚未启动")
		}
		return publisher.SendKeyTap(keycode)
	}
	if len(parts) >= 3 && parts[0] == "input" && parts[1] == "text" {
		publisher := s.publisher()
		if publisher == nil {
			return fmt.Errorf("WebRTC 服务尚未启动")
		}
		return publisher.SendText(strings.Join(parts[2:], " "))
	}
	return fmt.Errorf("不支持的命令: %s", command)
}

func randomToken() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}
