package agentapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mps233/la-pluma/go/internal/contract"
)

// TestEveryContractOperationHasARegisteredRoute keeps the operation registry
// and the actual mux in sync in the direction that matters for callers: every
// operation advertised by the manifest/OpenAPI must resolve to a route. The
// reverse direction is intentionally open because the client also uses
// non-advertised routes (config CRUD, schedules, preview transport).
func TestEveryContractOperationHasARegisteredRoute(t *testing.T) {
	handler := New(nil, nil)
	mux, ok := handler.handler.(*http.ServeMux)
	if !ok {
		t.Fatalf("handler.handler is %T, want *http.ServeMux", handler.handler)
	}

	operations := contract.Operations()
	if len(operations) == 0 {
		t.Fatal("contract.Operations() returned no operations")
	}

	for _, operation := range operations {
		if !strings.HasPrefix(operation.Path, "/api/agent") {
			continue
		}
		relative := strings.TrimPrefix(operation.Path, "/api/agent")
		if relative == "" {
			relative = "/"
		}
		concrete := concretePath(relative)
		request := httptest.NewRequest(operation.Method, concrete, nil)
		_, pattern := mux.Handler(request)
		if pattern == "" {
			t.Errorf("operation %s (%s %s) has no registered route", operation.ID, operation.Method, operation.Path)
		}
	}
}

// concretePath replaces every {name} or {name...} segment with a literal so
// the mux can match it. The handler is never invoked, so the value is inert.
func concretePath(pattern string) string {
	segments := strings.Split(pattern, "/")
	for index, segment := range segments {
		if strings.HasPrefix(segment, "{") && strings.HasSuffix(segment, "}") {
			segments[index] = "contract-test"
		}
	}
	return strings.Join(segments, "/")
}
