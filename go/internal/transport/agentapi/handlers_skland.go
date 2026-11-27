package agentapi

import (
	"context"
	"net/http"
	"time"

	"github.com/mps233/la-pluma/go/internal/transport/httpx"
)

func (h *Handler) sklandStatus(w http.ResponseWriter, r *http.Request) {
	value, err := h.app.Skland.Status()
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, value, "", nil)
}

func (h *Handler) sklandSnapshot(w http.ResponseWriter, r *http.Request) {
	snapshot, available, err := h.app.Skland.Snapshot()
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{
		"available": available,
		"snapshot":  snapshot,
	}, "", nil)
}

func (h *Handler) sklandLogin(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	status, err := h.app.Skland.Login(
		ctx,
		stringField(body, "account"),
		stringField(body, "password"),
		stringField(body, "uid"),
	)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, status, "森空岛登录成功", nil)
}

func (h *Handler) saveSklandCredentials(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	status, err := h.app.Skland.SaveCredentials(
		ctx,
		stringField(body, "cred"),
		stringField(body, "token"),
		stringField(body, "uid"),
	)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, status, "森空岛凭证已保存", nil)
}

func (h *Handler) clearSklandCredentials(w http.ResponseWriter, r *http.Request) {
	if err := h.app.Skland.ClearCredentials(); err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, nil, "森空岛凭证已清除", nil)
}

func (h *Handler) syncSkland(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
	defer cancel()
	status, err := h.app.Skland.Sync(ctx)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, status, "森空岛数据已同步", nil)
}
