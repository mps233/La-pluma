// Package bootstrap wires the HTTP surface shared by the headless server and
// the desktop shell. Entry-specific options (auth token, port discovery,
// desktop-only behavior) stay with the entry so both mounts cannot drift.
package bootstrap

import (
	"log/slog"

	"github.com/mps233/la-pluma/go/internal/app"
	scwebrtc "github.com/mps233/la-pluma/go/internal/infra/webrtc"
	"github.com/mps233/la-pluma/go/internal/transport/agentapi"
	"github.com/mps233/la-pluma/go/internal/transport/assetsapi"
	"github.com/mps233/la-pluma/go/internal/transport/httpapi"
	"github.com/mps233/la-pluma/go/internal/transport/quotesapi"
	"github.com/mps233/la-pluma/go/internal/transport/signaling"
)

// ServerOptions returns the handler mounts both entries must share.
func ServerOptions(application *app.App, logger *slog.Logger) []httpapi.Option {
	signalServer := signaling.New(func() *scwebrtc.Publisher {
		return application.WebRTC.CurrentPublisher()
	}, logger)
	signalServer.SetICEServers(application.WebRTC.ICEServers)
	return []httpapi.Option{
		httpapi.WithAgentHandler(agentapi.New(application, logger)),
		httpapi.WithSignalingHandler(signalServer.Handler()),
		httpapi.WithQuotesHandler(quotesapi.NewHandler(application.Quotes)),
		httpapi.WithAssetsHandler(assetsapi.New(application.Assets, logger)),
	}
}
