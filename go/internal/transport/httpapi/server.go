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

type Option func(*serverOptions)

type serverOptions struct {
	agentHandler     http.Handler
	signalingHandler http.Handler
	quotesHandler    http.Handler
	assetsHandler    http.Handler
}

// WithAgentHandler mounts the /api/agent subtree before the generic API
// fallback. The handler receives paths with /api/agent stripped.
func WithAgentHandler(handler http.Handler) Option {
	return func(options *serverOptions) {
		options.agentHandler = handler
	}
}

// WithSignalingHandler mounts the /webrtc-signaling subtree. The handler
// receives paths with /webrtc-signaling stripped.
func WithSignalingHandler(handler http.Handler) Option {
	return func(options *serverOptions) {
		options.signalingHandler = handler
	}
}

// WithQuotesHandler mounts the /api/operator-quotes subtree.
func WithQuotesHandler(handler http.Handler) Option {
	return func(options *serverOptions) {
		options.quotesHandler = handler
	}
}

// WithAssetsHandler mounts the public /api/maa-assets subtree.
func WithAssetsHandler(handler http.Handler) Option {
	return func(options *serverOptions) {
		options.assetsHandler = handler
	}
}

func New(cfg config.Config, logger *slog.Logger, options ...Option) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"success": true, "status": "ok"})
	})

	// Ticket issuance and the WebSocket gateway are mounted below when the
	// application supplies a signaling handler.
	mux.HandleFunc("/webrtc-signaling", signalingNotFound)

	opts := serverOptions{}
	for _, option := range options {
		option(&opts)
	}
	if opts.agentHandler != nil {
		mux.Handle("/api/agent/", http.StripPrefix("/api/agent", opts.agentHandler))
	}
	if opts.signalingHandler != nil {
		mux.Handle("/webrtc-signaling/", http.StripPrefix("/webrtc-signaling", opts.signalingHandler))
	} else {
		mux.HandleFunc("/webrtc-signaling/", signalingNotFound)
	}
	if opts.assetsHandler != nil {
		mux.Handle("/api/maa-assets/", http.StripPrefix("/api/maa-assets", opts.assetsHandler))
	} else {
		mux.HandleFunc("/api/maa-assets", assetsPlaceholder)
		mux.HandleFunc("/api/maa-assets/", assetsPlaceholder)
	}
	if opts.quotesHandler != nil {
		mux.Handle("/api/operator-quotes/", http.StripPrefix("/api/operator-quotes", opts.quotesHandler))
	}

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
