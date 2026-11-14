package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"

	"github.com/mps233/la-pluma/go/internal/app"
	configapp "github.com/mps233/la-pluma/go/internal/app/config"
	"github.com/mps233/la-pluma/go/internal/app/quotes"
	"github.com/mps233/la-pluma/go/internal/config"
	scwebrtc "github.com/mps233/la-pluma/go/internal/infra/webrtc"
	"github.com/mps233/la-pluma/go/internal/transport/agentapi"
	"github.com/mps233/la-pluma/go/internal/transport/httpapi"
	"github.com/mps233/la-pluma/go/internal/transport/signaling"
)

const desktopPort = 32123

func desktopHost() string {
	host := strings.TrimSpace(os.Getenv("LA_PLUMA_HOST"))
	if host == "" {
		return "127.0.0.1"
	}
	return host
}

var activeDesktop *desktopRuntime

func main() {
	mygo.App.SetName("La Pluma")
	mygo.Bind(DesktopBridge{})
	if !mygo.App.RequestSingleInstanceLock() {
		os.Exit(0)
	}
	mygo.App.OnWindowAllClosed(func() {
		// Keep the scheduler and device service alive in the tray.
	})
	// A second launch and a Dock click must recover the window after the user
	// closed it; both events arrive on this process, not on a new one.
	mygo.App.OnSecondInstance(func([]string, string) {
		if activeDesktop != nil {
			activeDesktop.showWindow()
		}
	})
	mygo.App.OnActivate(func(hasVisibleWindows bool) {
		if !hasVisibleWindows && activeDesktop != nil {
			activeDesktop.showWindow()
		}
	})
	mygo.App.OnDidBecomeActive(func() {
		if activeDesktop != nil {
			activeDesktop.showWindow()
		}
	})
	mygo.App.WhenReady(startDesktop)
	if err := mygo.App.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "la pluma:", err)
		os.Exit(1)
	}
}

// abortStartup exits instead of returning into a windowless event loop. A
// failed listen or app.New would otherwise leave a process that holds the
// single-instance lock with no window and no tray icon.
func abortStartup(logger *slog.Logger, message string, err error) {
	logger.Error(message, "error", err)
	mygo.App.Exit(1)
}

// rotatingFileWriter keeps the desktop log bounded. HTTP access logs are
// appended per request, so an unbounded file would grow without limit.
type rotatingFileWriter struct {
	path    string
	maxSize int64
	keep    int
	mu      sync.Mutex
	file    *os.File
	size    int64
}

func newRotatingFileWriter(path string, maxSize int64, keep int) (*rotatingFileWriter, error) {
	writer := &rotatingFileWriter{path: path, maxSize: maxSize, keep: keep}
	if err := writer.open(); err != nil {
		return nil, err
	}
	return writer, nil
}

func (w *rotatingFileWriter) open() error {
	file, err := os.OpenFile(w.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return err
	}
	w.file = file
	w.size = info.Size()
	return nil
}

func (w *rotatingFileWriter) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		if err := w.open(); err != nil {
			return 0, err
		}
	}
	if w.maxSize > 0 && w.size > 0 && w.size+int64(len(data)) > w.maxSize {
		w.rotate()
	}
	written, err := w.file.Write(data)
	w.size += int64(written)
	return written, err
}

func (w *rotatingFileWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		return nil
	}
	err := w.file.Close()
	w.file = nil
	return err
}

func (w *rotatingFileWriter) rotate() {
	_ = w.file.Close()
	w.file = nil
	if w.keep > 0 {
		for index := w.keep - 1; index >= 1; index-- {
			_ = os.Rename(fmt.Sprintf("%s.%d", w.path, index), fmt.Sprintf("%s.%d", w.path, index+1))
		}
		_ = os.Rename(w.path, w.path+".1")
	} else {
		_ = os.Remove(w.path)
	}
	w.size = 0
	_ = w.open()
}

type desktopRuntime struct {
	app         *app.App
	server      *http.Server
	listener    net.Listener
	tokenHolder *atomic.Value
	tokenEnv    bool
	baseURL     string
	closeOnce   sync.Once
	window      *mygo.Window
	tray        *mygo.Tray
	panel       *mygo.Window
}

func (r *desktopRuntime) currentToken() string {
	if r.tokenHolder == nil {
		return ""
	}
	if token, ok := r.tokenHolder.Load().(string); ok {
		return token
	}
	return ""
}

func startDesktop() {
	applySavedMAAExecutable()
	resolveDesktopMAA()
	logOutput := io.Writer(os.Stderr)
	logPath := ""
	if logsDir, err := mygo.App.Path(mygo.PathLogs); err == nil {
		logPath = filepath.Join(logsDir, "la-pluma.log")
		if writer, err := newRotatingFileWriter(logPath, 10<<20, 3); err == nil {
			logOutput = io.MultiWriter(os.Stderr, writer)
		}
	}
	logger := slog.New(slog.NewTextHandler(logOutput, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	userData, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		abortStartup(logger, "user data path", err)
		return
	}
	cacheDir, err := mygo.App.Path(mygo.PathCache)
	if err != nil {
		abortStartup(logger, "cache path", err)
		return
	}
	resources, _ := mygo.App.Path(mygo.PathResources)
	seedDataDir(resources, filepath.Join(userData, "data"))
	clientDist := os.Getenv("LA_PLUMA_CLIENT_DIST")
	if clientDist == "" {
		if candidate := filepath.Join(resources, "client"); directoryExists(candidate) {
			clientDist = candidate
		} else if candidate := filepath.Join(resources, "dist"); directoryExists(candidate) {
			clientDist = candidate
		} else if candidate := filepath.Join("..", "client", "dist"); directoryExists(candidate) {
			clientDist = candidate
		}
	}
	clientDist = resolveClientDist(clientDist)
	scrcpyServer := os.Getenv("LA_PLUMA_SCRCPY_SERVER_PATH")
	if scrcpyServer == "" {
		candidate := filepath.Join(resources, "scrcpy-server")
		if fileExists(candidate) {
			scrcpyServer = candidate
			_ = os.Setenv("LA_PLUMA_SCRCPY_SERVER_PATH", scrcpyServer)
		}
	}
	tokenSettings := loadDesktopSettings()
	token := strings.TrimSpace(os.Getenv("LA_PLUMA_TOKEN"))
	tokenFromEnv := token != ""
	if token == "" {
		savedToken, savedErr := normalizeDesktopAccessToken(tokenSettings.AccessToken)
		if savedErr == nil {
			token = savedToken
		} else {
			token, err = randomHex(16)
			if err != nil {
				abortStartup(logger, "token", err)
				return
			}
			tokenSettings.AccessToken = token
			if saveErr := saveDesktopSettings(tokenSettings); saveErr != nil {
				logger.Warn("persist access token", "error", saveErr)
			}
		}
	}
	tokenHolder := &atomic.Value{}
	tokenHolder.Store(token)

	defaultPaths := config.DefaultPaths(".")
	defaultPaths.DataDir = filepath.Join(userData, "data")
	defaultPaths.CacheDir = cacheDir
	defaultPaths.ClientDist = clientDist
	host := desktopHost()
	cfg := config.Config{
		Host:     host,
		Port:     desktopPort,
		BasePath: "/",
		Token:    token,
		Paths:    defaultPaths,
	}
	application, err := app.New(cfg, logger)
	if err != nil {
		abortStartup(logger, "app", err)
		return
	}
	application.ResumeInterruptedFlows(context.Background(), logger)
	signalServer := signaling.New(func() *scwebrtc.Publisher {
		return application.WebRTC.CurrentPublisher()
	}, logger)
	signalServer.SetICEServers(application.WebRTC.ICEServers)
	handler := httpapi.New(cfg, logger,
		httpapi.WithAgentHandler(agentapi.New(application, logger)),
		httpapi.WithSignalingHandler(signalServer.Handler()),
		httpapi.WithQuotesHandler(quotes.NewHandler(application.Quotes)),
		httpapi.WithAssetsHandler(application.Assets),
		httpapi.WithTokenSource(func() string { return tokenHolder.Load().(string) }),
	).Handler()

	listener, err := net.Listen("tcp", fmt.Sprintf("%s:%d", host, desktopPort))
	if err != nil {
		_ = application.Close(context.Background())
		abortStartup(logger, "listen", fmt.Errorf("port %d: %w", desktopPort, err))
		return
	}
	runtimeState := &desktopRuntime{
		app:         application,
		listener:    listener,
		tokenHolder: tokenHolder,
		tokenEnv:    tokenFromEnv,
		// The embedded window always loads loopback, even when the server is
		// bound to all interfaces for a phone on the LAN.
		baseURL: fmt.Sprintf("http://127.0.0.1:%d/", desktopPort),
	}
	runtimeState.server = &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		logger.Info("desktop server", "bind", listener.Addr().String(), "url", runtimeState.baseURL, "data_dir", cfg.Paths.DataDir)
		if err := runtimeState.server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("desktop server", "error", err)
		}
	}()

	// Drop service workers and HTTP caches left by an older build: the
	// desktop shell serves the app same-origin, and a stale worker would
	// otherwise keep an old UI alive. Local storage (token, prefs) stays.
	_ = mygo.DefaultSession().ClearData(mygo.SiteDataServiceWorkers | mygo.SiteDataCaches)

	activeDesktop = runtimeState
	runtimeState.showWindow()
	runtimeState.setupTray(logger)
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) {
		runtimeState.close(logger)
	})
}

func (r *desktopRuntime) setupTray(logger *slog.Logger) {
	tray, err := mygo.NewTray(mygo.TrayOptions{
		Icon:           trayIcon(),
		IconIsTemplate: runtime.GOOS == "darwin",
		ToolTip:        "La Pluma",
	})
	if err != nil {
		logger.Warn("tray", "error", err)
		return
	}
	r.tray = tray
	menu := mygo.NewMenu([]*mygo.MenuItem{
		{Label: "状态面板", Click: func(*mygo.MenuItem, *mygo.Window) {
			r.togglePanel()
		}},
		{Label: "显示主窗口", Click: func(*mygo.MenuItem, *mygo.Window) {
			r.showWindow()
		}},
		mygo.Separator(),
		{Label: "退出 La Pluma", Click: func(*mygo.MenuItem, *mygo.Window) {
			r.close(logger)
			mygo.App.Quit()
		}},
	})
	if runtime.GOOS == "linux" {
		tray.SetMenu(menu)
	} else {
		tray.SetMenu(menu)
		tray.OnClick(func() {
			r.togglePanel()
		})
	}
	mygo.App.OnWillQuit(func(*mygo.QuitEvent) { tray.Destroy() })
}

func (r *desktopRuntime) close(logger *slog.Logger) {
	r.closeOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		if r.app != nil {
			if err := r.app.Close(ctx); err != nil {
				logger.Warn("app close", "error", err)
			}
		}
		if r.server != nil {
			_ = r.server.Shutdown(ctx)
		}
		if r.listener != nil {
			_ = r.listener.Close()
		}
	})
}

func preloadScript(token string) string {
	return fmt.Sprintf(`try {
  localStorage.setItem('laPlumaToken', %q);
  window.__LA_PLUMA_DESKTOP__ = true;
} catch (error) {}`, token)
}

func randomHex(size int) (string, error) {
	bytes := make([]byte, size)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	const hexChars = "0123456789abcdef"
	out := make([]byte, size*2)
	for index, value := range bytes {
		out[index*2] = hexChars[value>>4]
		out[index*2+1] = hexChars[value&0x0f]
	}
	return string(out), nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func resolveClientDist(candidate string) string {
	if candidate == "" {
		return candidate
	}
	absolute, err := filepath.Abs(candidate)
	if err == nil {
		return absolute
	}
	return candidate
}

func directoryExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func trayIcon() []byte {
	img := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	ink := color.NRGBA{R: 232, G: 237, B: 244, A: 255}
	if runtime.GOOS != "darwin" {
		ink = color.NRGBA{R: 79, G: 124, B: 255, A: 255}
	}
	for y := 0; y < 32; y++ {
		for x := 0; x < 32; x++ {
			dx, dy := float64(x)-15.5, float64(y)-15.5
			distance := dx*dx + dy*dy
			if distance < 13*13 && distance > 10*10 || distance < 9*9 && distance > 6*6 || distance < 4*4 && distance > 2*2 {
				img.Set(x, y, ink)
			}
		}
	}
	var buffer bytes.Buffer
	_ = png.Encode(&buffer, img)
	return buffer.Bytes()
}

// DesktopBridge exposes desktop-only capabilities to the trusted loopback
// page. It is intentionally narrow: no arbitrary command execution.
type DesktopBridge struct{}

func (DesktopBridge) ChooseExecutable(kind string) (string, error) {
	title := "选择可执行文件"
	switch kind {
	case "adb":
		title = "选择 ADB 可执行文件"
	case "maa":
		title = "选择 MAA CLI 可执行文件"
	}
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Title:   title,
		Filters: []mygo.FileFilter{{Name: "可执行文件", Extensions: []string{"*"}}},
	})
	if err != nil || len(paths) == 0 {
		return "", err
	}
	return paths[0], nil
}

// SetExecutable persists the path chosen in the desktop settings and applies
// it to the running services. ADB is saved into the default MAA profile so the
// MAA CLI and the Go execution adapters read the same connection.
func (DesktopBridge) SetExecutable(kind, path string) error {
	path = strings.TrimSpace(path)
	if path == "" || !fileExists(path) {
		return errors.New("可执行文件路径不存在")
	}
	if activeDesktop == nil || activeDesktop.app == nil {
		return errors.New("桌面服务尚未就绪")
	}
	switch kind {
	case "maa":
		settings := loadDesktopSettings()
		settings.MAAExecutable = path
		if err := saveDesktopSettings(settings); err != nil {
			return err
		}
		activeDesktop.app.MAA.SetPath(path)
		_ = os.Setenv("MAA_CLI_PATH", path)
		return nil
	case "adb":
		profile, err := activeDesktop.app.Profiles.Load(configapp.DefaultProfileName)
		if err != nil {
			return err
		}
		merged := activeDesktop.app.Profiles.MergeConnection(profile, map[string]any{"adb_path": path})
		if merged == nil {
			return errors.New("无法更新连接配置")
		}
		if err := activeDesktop.app.Profiles.Save(configapp.DefaultProfileName, merged); err != nil {
			return err
		}
		address, _ := profile["address"].(string)
		activeDesktop.app.WebRTC.SetConnection(path, address)
		return nil
	default:
		return errors.New("不支持的可执行文件类型")
	}
}

func (DesktopBridge) OpenDataDir() error {
	path, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		return err
	}
	return mygo.Shell.OpenPath(path)
}

func (DesktopBridge) OpenLogs() error {
	path, err := mygo.App.Path(mygo.PathLogs)
	if err != nil {
		return err
	}
	return mygo.Shell.OpenPath(path)
}

func (DesktopBridge) Notify(title, body string) error {
	notification := mygo.NewNotification(mygo.NotificationOptions{
		ID:    "la-pluma-" + title,
		Title: title,
		Body:  body,
	})
	return notification.Show()
}

func (DesktopBridge) GetAutostart() bool {
	return mygo.App.OpenAtLogin()
}

func (DesktopBridge) SetAutostart(enabled bool) error {
	return mygo.App.SetOpenAtLogin(enabled)
}

func (DesktopBridge) AppInfo() map[string]any {
	userData, _ := mygo.App.Path(mygo.PathUserData)
	return map[string]any{
		"name":     "La Pluma",
		"version":  "0.1.0",
		"platform": runtime.GOOS,
		"userData": userData,
	}
}

// GetAccessToken returns the token the loopback server currently accepts and
// where it came from. The token is shown in the desktop settings so the user
// can use the same value on a phone or another browser.
func (DesktopBridge) GetAccessToken() (map[string]any, error) {
	if activeDesktop == nil {
		return nil, errors.New("桌面服务尚未就绪")
	}
	source := "settings"
	if activeDesktop.tokenEnv {
		source = "env"
	}
	return map[string]any{"token": activeDesktop.currentToken(), "source": source}, nil
}

// SetAccessToken validates and persists a user-chosen token and applies it to
// the running loopback server immediately. The caller updates the page's
// stored token after this returns so the next request uses the new value.
func (DesktopBridge) SetAccessToken(value string) (string, error) {
	if activeDesktop == nil {
		return "", errors.New("桌面服务尚未就绪")
	}
	if activeDesktop.tokenEnv {
		return "", errors.New("访问令牌由环境变量 LA_PLUMA_TOKEN 设置，无法在应用内修改")
	}
	if activeDesktop.tokenHolder == nil {
		return "", errors.New("桌面服务尚未就绪")
	}
	token, err := normalizeDesktopAccessToken(value)
	if err != nil {
		return "", err
	}
	settings := loadDesktopSettings()
	settings.AccessToken = token
	if err := saveDesktopSettings(settings); err != nil {
		return "", err
	}
	activeDesktop.tokenHolder.Store(token)
	return token, nil
}

// normalizeDesktopAccessToken keeps the token usable in HTTP headers and
// compatible with the browser input: visible ASCII only, 6–128 characters.
func normalizeDesktopAccessToken(value string) (string, error) {
	token := strings.TrimSpace(value)
	token = strings.TrimSpace(strings.TrimPrefix(token, "Bearer "))
	if token == "" {
		return "", errors.New("访问令牌不能为空")
	}
	if len(token) < 6 || len(token) > 128 {
		return "", errors.New("访问令牌需要 6–128 个字符")
	}
	for _, char := range token {
		if char < 0x21 || char > 0x7e {
			return "", errors.New("访问令牌只能使用可见的 ASCII 字符，且不能包含空格")
		}
	}
	return token, nil
}

// seedDataDir copies static game data shipped under resources/seed into the
// user data directory. Existing files are never overwritten, and
// account-specific snapshots are not part of the seed.
func seedDataDir(resources, dataDir string) {
	seedDir := filepath.Join(resources, "seed")
	entries, err := os.ReadDir(seedDir)
	if err != nil {
		return
	}
	_ = os.MkdirAll(dataDir, 0o700)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		source := filepath.Join(seedDir, entry.Name())
		target := filepath.Join(dataDir, entry.Name())
		if _, err := os.Stat(target); err == nil {
			continue
		}
		data, err := os.ReadFile(source)
		if err != nil {
			continue
		}
		_ = os.WriteFile(target, data, 0o600)
	}
}

// showWindow opens the main window, or reopens it after the user closed it.
// The scheduler and device services stay alive in the tray meanwhile.
func (r *desktopRuntime) showWindow() {
	if r.window != nil {
		r.window.Show()
		r.window.Focus()
		return
	}
	titleBarStyle := mygo.TitleBarDefault
	var trafficLightPosition *mygo.Point
	if runtime.GOOS == "darwin" {
		titleBarStyle = mygo.TitleBarHiddenInset
		trafficLightPosition = &mygo.Point{X: 22, Y: 22}
	}
	window := mygo.NewWindow(mygo.WindowOptions{
		Title: "La Pluma",
		// A fresh query bypasses a WKWebView document cache that may still
		// point at asset hashes from an earlier build.
		URL:                  fmt.Sprintf("%s?desktop=%d", r.baseURL, time.Now().UnixMilli()),
		Width:                1180,
		Height:               800,
		MinWidth:             980,
		MinHeight:            680,
		BackgroundColor:      "#101318",
		StateKey:             "main",
		TitleBarStyle:        titleBarStyle,
		TrafficLightPosition: trafficLightPosition,
		Page: mygo.PageOptions{
			TrustedOrigins:       []string{r.baseURL[:len(r.baseURL)-1]},
			BackgroundThrottling: mygo.ThrottlingOff,
			Autoplay:             mygo.AutoplayAllow,
			PreloadScript:        preloadScript(r.currentToken()),
		},
	})
	if runtime.GOOS == "darwin" {
		// The sidebar frame is inset 0.75rem (12 DIPs) from the window edge, so
		// concentric corners need the window radius to be the panel's 1.625rem
		// (26) plus that inset, not the same 26: equal radii with an inset leave
		// a wider gap at the curve than along the straight edges.
		roundWindowCorners(window, 26+12)
	}
	window.OnClosed(func() {
		if r.window == window {
			r.window = nil
		}
	})
	r.window = window
}

// stopAllTasks stops the scheduler flow, the mastery campaign and the current
// MAA process. The tray button must not leave a scheduled flow or the mastery
// tick loop to start the next MAA task a few seconds later.
func (r *desktopRuntime) stopAllTasks(ctx context.Context) {
	if r.app == nil {
		return
	}
	r.app.Scheduler.Stop(ctx)
	if _, err := r.app.Mastery.StopCampaign(ctx); err != nil {
		slog.Default().Warn("stop mastery campaign", "error", err)
	}
	if err := r.app.MAAService.Stop(ctx); err != nil {
		slog.Default().Warn("stop MAA task", "error", err)
	}
}

const desktopSettingsFileName = "desktop-settings.json"

type desktopSettings struct {
	MAAExecutable string `json:"maaExecutable,omitempty"`
	AccessToken   string `json:"accessToken,omitempty"`
}

func desktopSettingsPath() (string, error) {
	userData, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		return "", err
	}
	return filepath.Join(userData, desktopSettingsFileName), nil
}

func loadDesktopSettings() desktopSettings {
	path, err := desktopSettingsPath()
	if err != nil {
		return desktopSettings{}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return desktopSettings{}
	}
	var settings desktopSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return desktopSettings{}
	}
	return settings
}

func saveDesktopSettings(settings desktopSettings) error {
	path, err := desktopSettingsPath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

// applySavedMAAExecutable lets a path chosen in the desktop settings survive a
// restart. An explicit environment override still wins.
func applySavedMAAExecutable() {
	if strings.TrimSpace(os.Getenv("MAA_CLI_PATH")) != "" {
		return
	}
	path := strings.TrimSpace(loadDesktopSettings().MAAExecutable)
	if path == "" || !fileExists(path) {
		return
	}
	_ = os.Setenv("MAA_CLI_PATH", path)
}

// resolveDesktopMAA makes a GUI-launched app find maa even when Finder or the
// Windows start menu did not inherit the user's shell PATH.
func resolveDesktopMAA() {
	if strings.TrimSpace(os.Getenv("MAA_CLI_PATH")) != "" {
		return
	}
	if path, err := exec.LookPath("maa"); err == nil && path != "" {
		_ = os.Setenv("MAA_CLI_PATH", path)
		return
	}
	home, _ := os.UserHomeDir()
	candidates := []string{}
	switch runtime.GOOS {
	case "darwin":
		candidates = []string{"/opt/homebrew/bin/maa", "/usr/local/bin/maa", filepath.Join(home, ".local", "bin", "maa")}
	case "windows":
		candidates = []string{
			filepath.Join(home, ".local", "bin", "maa.exe"),
			filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "maa", "maa.exe"),
		}
	default:
		candidates = []string{"/usr/local/bin/maa", "/usr/bin/maa", filepath.Join(home, ".local", "bin", "maa")}
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			_ = os.Setenv("MAA_CLI_PATH", candidate)
			return
		}
	}
}

func (r *desktopRuntime) togglePanel() {
	if r.panel != nil {
		r.panel.Close()
		return
	}
	r.panel = mygo.NewFlyout(mygo.FlyoutOptions{
		Tray:      r.tray,
		Placement: mygo.PlacementBottom,
		Gap:       4,
		Width:     320,
		Height:    230,
		Focusable: true,
		Shadow:    true,
		Popover:   true,
		Content:   ui.View(r.panelView),
	})
	r.panel.OnClosed(func() { r.panel = nil })
}

func (r *desktopRuntime) panelView(c *ui.Context) {
	theme := c.Theme()
	column := ui.Column(c).Fill().Padding(16).Gap(10)
	column.Radius(10).Material(glass.Glass{Tint: ui.RGBA(theme.Surface.R, theme.Surface.G, theme.Surface.B, 0.72)})
	column.Children(func() {
		ui.Text(c, "La Pluma").FontSize(17).Bold()
		status := "空闲"
		if task := r.app.TaskStatus(); task.IsRunning {
			status = "运行中"
			if task.TaskName != "" {
				status += "：" + task.TaskName
			}
		}
		ui.Textf(c, "状态：%s", status).FontSize(12).TextColor(theme.TextMuted)
		if run, ok := r.app.CurrentRun(); ok {
			ui.Textf(c, "当前 Run：%s", run.OperationID).FontSize(12).TextColor(theme.TextMuted)
		}
		if info := r.app.Execution.Status(); info.State != "" {
			ui.Textf(c, "MAA 租约：%s", info.State).FontSize(12).TextColor(theme.TextMuted)
		}
		ui.Row(c).Gap(8).Children(func() {
			ui.Button(c.Key("show"), "打开主窗口").OnClick(func() {
				r.showWindow()
				if r.panel != nil {
					r.panel.Close()
				}
			})
			ui.Button(c.Key("stop"), "停止任务").OnClick(func() {
				go func() {
					ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
					defer cancel()
					r.stopAllTasks(ctx)
				}()
			})
		})
		ui.Row(c).Gap(8).Children(func() {
			ui.Button(c.Key("logs"), "打开日志").OnClick(func() {
				if logs, err := mygo.App.Path(mygo.PathLogs); err == nil {
					_ = mygo.Shell.OpenPath(logs)
				}
			})
			ui.Button(c.Key("quit"), "退出").OnClick(func() {
				r.close(slog.Default())
				mygo.App.Quit()
			})
		})
	})
}
