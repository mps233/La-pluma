package agentapi

import (
	"net/http"

	"github.com/mps233/la-pluma/go/internal/transport/httpx"
)

func dropDays(r *http.Request) int {
	days := parseBoundedInt(r.URL.Query().Get("days"), 7, 1, 365)
	return days
}

func (h *Handler) dropsToday(w http.ResponseWriter, r *http.Request) {
	value, err := h.app.Drops.GetTodayDrops()
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) dropsRecent(w http.ResponseWriter, r *http.Request) {
	value, err := h.app.Drops.GetRecentDrops(dropDays(r))
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) dropsStatistics(w http.ResponseWriter, r *http.Request) {
	value, err := h.app.Drops.GetDropStatistics(dropDays(r))
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}
