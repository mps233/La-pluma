package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/mps233/la-pluma/go/internal/app"
	"github.com/mps233/la-pluma/go/internal/app/quotes"
	"github.com/mps233/la-pluma/go/internal/config"
	scwebrtc "github.com/mps233/la-pluma/go/internal/infra/webrtc"
	"github.com/mps233/la-pluma/go/internal/transport/agentapi"
	"github.com/mps233/la-pluma/go/internal/transport/httpapi"
	"github.com/mps233/la-pluma/go/internal/transport/signaling"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg, err := config.LoadProcess()
	if err != nil {
		logger.Error("config", "error", err)
		os.Exit(1)
	}
	if cfg.Paths.ClientDist != "" {
		if _, statErr := os.Stat(cfg.Paths.ClientDist); statErr != nil {
			logger.Warn("client dist missing; SPA will return 404", "path", cfg.Paths.ClientDist)
		}
	}

	application, err := app.New(cfg, logger)
	if err != nil {
		logger.Error("app init", "error", err)
		os.Exit(1)
	}
	signalServer := signaling.New(func() *scwebrtc.Publisher {
		return application.WebRTC.CurrentPublisher()
	}, logger)
	server := httpapi.New(cfg, logger,
		httpapi.WithAgentHandler(agentapi.New(application, logger)),
		httpapi.WithSignalingHandler(signalServer.Handler()),
		httpapi.WithQuotesHandler(quotes.NewHandler(application.Quotes)),
		httpapi.WithAssetsHandler(application.Assets),
	)
	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		logger.Error("listen", "addr", addr, "error", err)
		os.Exit(1)
	}
	defer listener.Close()

	httpServer := &http.Server{
		Handler:           server.Handler(),
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		logger.Info("la pluma go server", "addr", listener.Addr().String(), "base_path", cfg.BasePath, "data_dir", cfg.Paths.DataDir)
		if cfg.TLSCertFile != "" {
			errCh <- httpServer.ServeTLS(listener, cfg.TLSCertFile, cfg.TLSKeyFile)
			return
		}
		errCh <- httpServer.Serve(listener)
	}()

	select {
	case <-ctx.Done():
		logger.Info("shutdown requested")
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("serve", "error", err)
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := application.Close(shutdownCtx); err != nil {
		logger.Error("app shutdown", "error", err)
	}
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown", "error", err)
		os.Exit(1)
	}
}
