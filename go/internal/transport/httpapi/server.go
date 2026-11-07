package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/mps233/la-pluma/go/internal/config"
	"github.com/mps233/la-pluma/go/internal/transport/httpx"
)

// Server owns the HTTP handler. Services are mounted here as they are ported;
// the router priority deliberately mirrors server/server.ts:
//   - /health and /webrtc-signaling/api/login are explicit
//   - /api/maa-assets is public (mounted before auth in the Node server)
//   - /api and /api/agent are token-protected when LA_PLUMA_TOKEN is set
//   - the SPA lives under basePath and never receives API paths
type Server struct {
	cfg     config.Config
	logger  *slog.Logger
	handler http.Handler
}

func New(cfg config.Config, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"success": true, "status": "ok"})
	})

	// Ticket issuance is the only signaling endpoint exposed over the public
	// port; the media gateway lands here later.
	mux.HandleFunc("POST /webrtc-signaling/api/login", func(w http.ResponseWriter, r *http.Request) {
		httpx.Failure(w, http.StatusServiceUnavailable, &httpx.APIError{
			Code: "WEBRTC_NOT_READY", Message: "WebRTC 信令尚未实现", Retryable: true,
		})
	})
	mux.HandleFunc("/webrtc-signaling", signalingNotFound)
	mux.HandleFunc("/webrtc-signaling/", signalingNotFound)

	mux.HandleFunc("/api/maa-assets", assetsPlaceholder)
	mux.HandleFunc("/api/maa-assets/", assetsPlaceholder)
	mux.HandleFunc("/api", apiNotFound)
	mux.HandleFunc("/api/", apiNotFound)

	static := newStaticHandler(cfg.Paths.ClientDist, cfg.BasePath)
	if cfg.BasePath == "/" {
		mux.Handle("/", static)
	} else {
		mux.Handle(cfg.BasePath, static)
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			httpx.Failure(w, http.StatusNotFound, httpx.NewError("NOT_FOUND", "资源不存在"))
		})
	}

	handler := Chain(mux,
		Recover(logger),
		RequestID(),
		AccessLog(logger),
		CORS(),
		Gzip(),
		Auth(cfg.Token),
	)
	return &Server{cfg: cfg, logger: logger, handler: handler}
}

func (s *Server) Handler() http.Handler {
	return s.handler
}

func apiNotFound(w http.ResponseWriter, r *http.Request) {
	httpx.Failure(w, http.StatusNotFound, httpx.NewError("AGENT_NOT_FOUND", "API 不存在"))
}

func assetsPlaceholder(w http.ResponseWriter, r *http.Request) {
	httpx.Failure(w, http.StatusNotFound, httpx.NewError("ASSET_NOT_FOUND", "资源不存在"))
}

func signalingNotFound(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusNotFound, map[string]any{"error": "Not Found"})
}
