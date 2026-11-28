// Package httpclient owns HTTP client construction for the backend. Timeouts
// and transport defaults live here so call sites cannot drift; request-level
// work is still bounded by the caller's context. Retry policy stays with the
// service that understands its endpoint (currently infra/prts).
package httpclient

import (
	"net/http"
	"time"
)

// New returns a client with the given per-request timeout. A zero timeout
// leaves the deadline to request contexts.
func New(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout}
}

// Default returns a client without a client-level timeout.
func Default() *http.Client {
	return New(0)
}
