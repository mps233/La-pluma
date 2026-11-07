package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"

	"github.com/mps233/la-pluma/go/internal/app"
	"github.com/mps233/la-pluma/go/internal/app/quotes"
	"github.com/mps233/la-pluma/go/internal/config"
	scwebrtc "github.com/mps233/la-pluma/go/internal/infra/webrtc"
	"github.com/mps233/la-pluma/go/internal/transport/agentapi"
	"github.com/mps233/la-pluma/go/internal/transport/httpapi"
	"github.com/mps233/la-pluma/go/internal/transport/signaling"
)

const desktopPort = 32123

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
	mygo.App.WhenReady(startDesktop)
	if err := mygo.App.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "la pluma:", err)
		os.Exit(1)
	}
}

type desktopRuntime struct {
	app       *app.App
	server    *http.Server
	listener  net.Listener
	token     string
	baseURL   string
	closeOnce sync.Once
	window    *mygo.Window
	tray      *mygo.Tray
}

func startDesktop() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	userData, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		logger.Error("user data path", "error", err)
		return
	}
	cacheDir, err := mygo.App.Path(mygo.PathCache)
	if err != nil {
		logger.Error("cache path", "error", err)
		return
	}
	resources, _ := mygo.App.Path(mygo.PathResources)
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
	token := strings.TrimSpace(os.Getenv("LA_PLUMA_TOKEN"))
	if token == "" {
		token, err = randomHex(16)
		if err != nil {
			logger.Error("token", "error", err)
			return
		}
	}

	cfg := config.Config{
		Host:     "127.0.0.1",
		Port:     desktopPort,
		BasePath: "/",
		Token:    token,
		Paths: config.Paths{
			DataDir:    filepath.Join(userData, "data"),
			CacheDir:   cacheDir,
			ClientDist: clientDist,
		},
	}
	application, err := app.New(cfg, logger)
	if err != nil {
		logger.Error("app", "error", err)
		return
	}
	signalServer := signaling.New(func() *scwebrtc.Publisher {
		return application.WebRTC.CurrentPublisher()
	}, logger)
	handler := httpapi.New(cfg, logger,
		httpapi.WithAgentHandler(agentapi.New(application, logger)),
		httpapi.WithSignalingHandler(signalServer.Handler()),
		httpapi.WithQuotesHandler(quotes.NewHandler(application.Quotes)),
		httpapi.WithAssetsHandler(application.Assets),
	).Handler()

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", desktopPort))
	if err != nil {
		logger.Error("listen", "port", desktopPort, "error", err)
		_ = application.Close(context.Background())
		return
	}
	runtimeState := &desktopRuntime{
		app:      application,
		listener: listener,
		token:    token,
		baseURL:  "http://" + listener.Addr().String() + "/",
	}
	runtimeState.server = &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		logger.Info("desktop server", "url", runtimeState.baseURL, "data_dir", cfg.Paths.DataDir)
		if err := runtimeState.server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("desktop server", "error", err)
		}
	}()

	runtimeState.window = mygo.NewWindow(mygo.WindowOptions{
		Title:           "La Pluma",
		URL:             runtimeState.baseURL,
		Width:           1180,
		Height:          800,
		MinWidth:        980,
		MinHeight:       680,
		BackgroundColor: "#101318",
		StateKey:        "main",
		Page: mygo.PageOptions{
			TrustedOrigins:       []string{"http://" + listener.Addr().String()},
			BackgroundThrottling: mygo.ThrottlingOff,
			Autoplay:             mygo.AutoplayAllow,
			PreloadScript:        preloadScript(token),
		},
	})
	activeDesktop = runtimeState
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
		{Label: "显示主窗口", Click: func(*mygo.MenuItem, *mygo.Window) {
			if r.window != nil {
				r.window.Show()
			}
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
			if r.window != nil {
				r.window.Show()
			}
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
