package scrcpy

import (
	"bufio"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/infra/adb"
	"github.com/mps233/la-pluma/go/internal/infra/process"
)

const (
	defaultServerVersion = "3.3.4"
	defaultBitRate       = 8_000_000
	connectTimeout       = 10 * time.Second
	remoteServerPath     = "/data/local/tmp/scrcpy-server.jar"
	deviceNameBytes      = 64
)

type Options struct {
	ADB               *adb.Client
	Serial            string
	ServerPath        string
	ServerVersion     string
	BitRate           int
	MaxSize           int
	MaxFPS            int
	VideoCodec        string
	Control           bool
	Audio             bool
	ClipboardAutosync bool
	TunnelForward     bool
	Logger            *slog.Logger
}

type Session struct {
	opts   Options
	adb    *adb.Client
	logger *slog.Logger

	scid   uint32
	socket string

	VideoHeader VideoHeader
	Width       int
	Height      int

	videoConn net.Conn
	ctrlConn  net.Conn
	video     *bufio.Reader

	clipboardMu    sync.Mutex
	clipboard      string
	clipboardKnown bool
	clipboardCh    chan struct{}

	listener    net.Listener
	reverseUsed bool
	forwardPort int

	server *process.Process
	ctrlMu sync.Mutex
	mu     sync.Mutex
	closed bool
}

func New(options Options) *Session {
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	if options.ServerVersion == "" {
		options.ServerVersion = defaultServerVersion
	}
	if options.BitRate <= 0 {
		options.BitRate = defaultBitRate
	}
	if options.VideoCodec == "" {
		options.VideoCodec = "h264"
	}
	if options.ADB == nil {
		options.ADB = adb.New("adb")
	}
	scid := rand.Uint32N(0x7fffffff) + 1
	return &Session{
		opts:   options,
		adb:    options.ADB,
		logger: options.Logger,
		scid:   scid,
		socket: fmt.Sprintf("scrcpy_%08x", scid),
	}
}

func (s *Session) Start(ctx context.Context) error {
	if s.opts.Serial == "" {
		return fmt.Errorf("scrcpy: device serial is required")
	}
	if s.opts.ServerPath == "" {
		return fmt.Errorf("scrcpy: server jar path is required")
	}
	if _, err := os.Stat(s.opts.ServerPath); err != nil {
		return fmt.Errorf("scrcpy server jar: %w", err)
	}

	if err := s.adb.Push(ctx, s.opts.Serial, s.opts.ServerPath, remoteServerPath); err != nil {
		return fmt.Errorf("push scrcpy server: %w", err)
	}
	if s.opts.TunnelForward {
		if err := s.setupForward(ctx); err != nil {
			return err
		}
	} else {
		if err := s.setupReverse(ctx); err != nil {
			return err
		}
	}

	if err := s.startServer(ctx); err != nil {
		s.cleanupTunnel(ctx)
		return err
	}
	if err := s.connectStreams(ctx); err != nil {
		s.Close()
		return err
	}
	if s.opts.Control {
		s.startControlReader()
	}
	if err := s.readDeviceNameAndHeader(); err != nil {
		s.Close()
		return err
	}
	s.cleanupTunnel(ctx)
	return nil
}

func (s *Session) setupReverse(ctx context.Context) error {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	s.listener = listener
	port := listener.Addr().(*net.TCPAddr).Port
	remote := "localabstract:" + s.socket
	local := "tcp:" + strconv.Itoa(port)
	if err := s.adb.Reverse(ctx, s.opts.Serial, remote, local); err != nil {
		listener.Close()
		return fmt.Errorf("adb reverse: %w", err)
	}
	s.reverseUsed = true
	s.logger.Info("scrcpy reverse tunnel", "socket", s.socket, "port", port)
	return nil
}

func (s *Session) setupForward(ctx context.Context) error {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	local := "tcp:" + strconv.Itoa(port)
	remote := "localabstract:" + s.socket
	if err := s.adb.Forward(ctx, s.opts.Serial, local, remote); err != nil {
		return fmt.Errorf("adb forward: %w", err)
	}
	s.forwardPort = port
	s.logger.Info("scrcpy forward tunnel", "socket", s.socket, "port", port)
	return nil
}

func (s *Session) startServer(ctx context.Context) error {
	args := []string{"-s", s.opts.Serial, "shell",
		"CLASSPATH=" + remoteServerPath,
		"app_process", "/", "com.genymobile.scrcpy.Server",
		s.opts.ServerVersion,
		fmt.Sprintf("scid=%08x", s.scid),
		"log_level=info",
	}
	if !s.opts.Audio {
		args = append(args, "audio=false")
	}
	if !s.opts.Control {
		args = append(args, "control=false")
	}
	args = append(args, fmt.Sprintf("clipboard_autosync=%t", s.opts.ClipboardAutosync))
	if s.opts.BitRate != defaultBitRate {
		args = append(args, fmt.Sprintf("video_bit_rate=%d", s.opts.BitRate))
	}
	if s.opts.VideoCodec != "h264" {
		args = append(args, "video_codec="+s.opts.VideoCodec)
	}
	if s.opts.MaxSize > 0 {
		args = append(args, fmt.Sprintf("max_size=%d", s.opts.MaxSize))
	}
	if s.opts.MaxFPS > 0 {
		args = append(args, fmt.Sprintf("max_fps=%d", s.opts.MaxFPS))
	}
	if s.opts.TunnelForward {
		args = append(args, "tunnel_forward=true")
	}
	server, err := process.Start(s.adb.Path, args, process.Options{
		Stdout: &logWriter{logger: s.logger, prefix: "scrcpy-server"},
		Stderr: &logWriter{logger: s.logger, prefix: "scrcpy-server"},
	})
	if err != nil {
		return fmt.Errorf("start scrcpy server: %w", err)
	}
	s.server = server
	return nil
}

func (s *Session) connectStreams(ctx context.Context) error {
	if s.opts.TunnelForward {
		return s.connectForward(ctx)
	}
	return s.connectReverse(ctx)
}

func (s *Session) connectReverse(ctx context.Context) error {
	accept := func(label string) (net.Conn, error) {
		if tcp, ok := s.listener.(*net.TCPListener); ok {
			_ = tcp.SetDeadline(time.Now().Add(connectTimeout))
		}
		conn, err := s.listener.Accept()
		if err != nil {
			return nil, fmt.Errorf("accept %s: %w", label, err)
		}
		setNoDelay(conn)
		return conn, nil
	}
	video, err := accept("video")
	if err != nil {
		return err
	}
	s.videoConn = video
	if s.opts.Control {
		ctrl, err := accept("control")
		if err != nil {
			video.Close()
			return err
		}
		s.ctrlConn = ctrl
	}
	return nil
}

func (s *Session) connectForward(ctx context.Context) error {
	dial := func(label string) (net.Conn, error) {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", s.forwardPort), connectTimeout)
		if err != nil {
			return nil, fmt.Errorf("connect %s: %w", label, err)
		}
		setNoDelay(conn)
		return conn, nil
	}
	video, err := dial("video")
	if err != nil {
		return err
	}
	s.videoConn = video
	if s.opts.Control {
		ctrl, err := dial("control")
		if err != nil {
			video.Close()
			return err
		}
		s.ctrlConn = ctrl
	}
	return nil
}

func (s *Session) logInfo(message string, args ...any) {
	if s.logger != nil {
		s.logger.Info(message, args...)
	}
}

func (s *Session) startControlReader() {
	s.mu.Lock()
	conn := s.ctrlConn
	if s.clipboardCh == nil {
		s.clipboardCh = make(chan struct{}, 1)
	}
	s.mu.Unlock()
	if conn == nil {
		return
	}
	s.logInfo("scrcpy control reader started")
	go s.readControlLoop(bufio.NewReader(conn))
}

func (s *Session) readControlLoop(reader *bufio.Reader) {
	for {
		messageType, err := reader.ReadByte()
		if err != nil {
			s.logInfo("scrcpy control reader ended", "error", err)
			return
		}
		switch messageType {
		case DeviceMsgClipboard:
			var lengthBytes [4]byte
			if _, err := io.ReadFull(reader, lengthBytes[:]); err != nil {
				return
			}
			length := binary.BigEndian.Uint32(lengthBytes[:])
			if length > MaxClipboardBytes {
				return
			}
			data := make([]byte, length)
			if _, err := io.ReadFull(reader, data); err != nil {
				return
			}
			s.logInfo("scrcpy clipboard message", "length", length)
			s.setClipboard(string(data))
		case DeviceMsgAckClipboard:
			var sequence [8]byte
			if _, err := io.ReadFull(reader, sequence[:]); err != nil {
				return
			}
		default:
			return
		}
	}
}

func (s *Session) setClipboard(text string) {
	s.clipboardMu.Lock()
	s.clipboard = text
	s.clipboardKnown = true
	ch := s.clipboardCh
	s.clipboardMu.Unlock()
	if ch != nil {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (s *Session) GetClipboard(ctx context.Context) (string, error) {
	s.mu.Lock()
	if s.clipboardCh == nil {
		s.clipboardCh = make(chan struct{}, 1)
	}
	ch := s.clipboardCh
	conn := s.ctrlConn
	s.mu.Unlock()
	if conn == nil {
		return "", fmt.Errorf("scrcpy control is disabled")
	}
	select {
	case <-ch:
	default:
	}
	s.ctrlMu.Lock()
	err := WriteGetClipboard(conn, 0)
	s.ctrlMu.Unlock()
	s.logInfo("scrcpy clipboard request sent", "error", err)
	if err != nil {
		return "", err
	}
	select {
	case <-ch:
		s.clipboardMu.Lock()
		text := s.clipboard
		s.clipboardMu.Unlock()
		return text, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func (s *Session) SetClipboard(_ context.Context, text string, paste bool) error {
	s.ctrlMu.Lock()
	defer s.ctrlMu.Unlock()
	if s.ctrlConn == nil {
		return fmt.Errorf("scrcpy control is disabled")
	}
	return WriteSetClipboard(s.ctrlConn, 0, paste, text)
}

func (s *Session) readDeviceNameAndHeader() error {
	s.video = bufio.NewReaderSize(s.videoConn, 1<<20)
	if s.opts.TunnelForward {
		var dummy [1]byte
		if _, err := io.ReadFull(s.video, dummy[:]); err != nil {
			return fmt.Errorf("read forward dummy byte: %w", err)
		}
	}
	var name [deviceNameBytes]byte
	if _, err := io.ReadFull(s.video, name[:]); err != nil {
		return fmt.Errorf("read device name: %w", err)
	}
	header, err := ReadVideoHeader(s.video)
	if err != nil {
		return err
	}
	if header.Codec != CodecH264 {
		return fmt.Errorf("unsupported scrcpy video codec: %08x", header.Codec)
	}
	s.VideoHeader = header
	s.Width = int(header.Width)
	s.Height = int(header.Height)
	s.logger.Info("scrcpy session ready", "device", s.opts.Serial, "width", s.Width, "height", s.Height)
	return nil
}

func (s *Session) ReadVideoPacket() (PacketHeader, []byte, error) {
	s.mu.Lock()
	reader := s.video
	s.mu.Unlock()
	if reader == nil {
		return PacketHeader{}, nil, fmt.Errorf("video stream is not ready")
	}
	return ReadPacket(reader)
}

func (s *Session) SendTouch(action int, pointerID uint64, x, y int32, width, height uint16, pressure float32) error {
	s.ctrlMu.Lock()
	defer s.ctrlMu.Unlock()
	if s.ctrlConn == nil {
		return fmt.Errorf("scrcpy control is disabled")
	}
	action = NormalizeTouchAction(action)
	buttons := 1
	actionButton := 1
	if action == TouchActionUp || action == TouchActionCancel {
		buttons = 0
		actionButton = 0
		pressure = 0
	}
	return WriteTouch(s.ctrlConn, action, pointerID, x, y, width, height, pressure, actionButton, buttons)
}

func (s *Session) SendKey(action, keycode int) error {
	s.ctrlMu.Lock()
	defer s.ctrlMu.Unlock()
	if s.ctrlConn == nil {
		return fmt.Errorf("scrcpy control is disabled")
	}
	return WriteKeycode(s.ctrlConn, action, keycode, 0, 0)
}

func (s *Session) SendKeyTap(keycode int) error {
	if err := s.SendKey(KeyActionDown, keycode); err != nil {
		return err
	}
	return s.SendKey(KeyActionUp, keycode)
}

func (s *Session) SendText(text string) error {
	s.ctrlMu.Lock()
	defer s.ctrlMu.Unlock()
	if s.ctrlConn == nil {
		return fmt.Errorf("scrcpy control is disabled")
	}
	return WriteText(s.ctrlConn, text)
}

func (s *Session) SendScroll(x, y int32, width, height uint16, hScroll, vScroll float32, buttons int) error {
	s.ctrlMu.Lock()
	defer s.ctrlMu.Unlock()
	if s.ctrlConn == nil {
		return fmt.Errorf("scrcpy control is disabled")
	}
	return WriteScroll(s.ctrlConn, x, y, width, height, hScroll, vScroll, buttons)
}

func (s *Session) SendBackOrScreenOn(action int) error {
	s.ctrlMu.Lock()
	defer s.ctrlMu.Unlock()
	if s.ctrlConn == nil {
		return fmt.Errorf("scrcpy control is disabled")
	}
	return WriteBackOrScreenOn(s.ctrlConn, action)
}

func (s *Session) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	server := s.server
	video := s.videoConn
	ctrl := s.ctrlConn
	listener := s.listener
	s.mu.Unlock()

	if video != nil {
		video.Close()
	}
	if ctrl != nil {
		ctrl.Close()
	}
	if listener != nil {
		listener.Close()
	}
	if server != nil {
		_ = server.Terminate(3 * time.Second)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if s.reverseUsed {
		_ = s.adb.RemoveReverse(ctx, s.opts.Serial, "localabstract:"+s.socket)
	}
	if s.forwardPort != 0 {
		_ = s.adb.RemoveForward(ctx, s.opts.Serial, "tcp:"+strconv.Itoa(s.forwardPort))
	}
	return nil
}

func (s *Session) cleanupTunnel(ctx context.Context) {
	s.mu.Lock()
	listener := s.listener
	s.listener = nil
	s.mu.Unlock()
	if listener != nil {
		_ = listener.Close()
	}
	if s.forwardPort != 0 {
		_ = s.adb.RemoveForward(ctx, s.opts.Serial, "tcp:"+strconv.Itoa(s.forwardPort))
	}
	// Existing connections survive removal of the adb tunnel.
	if s.reverseUsed {
		_ = s.adb.RemoveReverse(ctx, s.opts.Serial, "localabstract:"+s.socket)
	}
}

func (s *Session) ServerPath() string {
	absolute, err := filepath.Abs(s.opts.ServerPath)
	if err != nil {
		return s.opts.ServerPath
	}
	return absolute
}

type logWriter struct {
	logger *slog.Logger
	prefix string
}

func (w *logWriter) Write(data []byte) (int, error) {
	if text := string(data); text != "" {
		w.logger.Debug(w.prefix, "line", text)
	}
	return len(data), nil
}

func setNoDelay(conn net.Conn) {
	if tcp, ok := conn.(*net.TCPConn); ok {
		_ = tcp.SetNoDelay(true)
	}
}
