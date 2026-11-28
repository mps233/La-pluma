package agentapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	webrtcapp "github.com/mps233/la-pluma/go/internal/app/webrtc"
	"github.com/mps233/la-pluma/go/internal/domain/agentrun"
	"github.com/mps233/la-pluma/go/internal/transport/httpx"
)

type webrtcStartBody struct {
	ProfileID     string `json:"profileId"`
	DeviceID      string `json:"deviceId"`
	Address       string `json:"address"`
	ADBPath       string `json:"adbPath"`
	ServerPath    string `json:"serverPath"`
	ServerVersion string `json:"serverVersion"`
	MaxSize       int    `json:"maxSize"`
	MaxFPS        int    `json:"maxFps"`
	BitRate       int    `json:"bitRate"`
}

func (h *Handler) webrtcStatus(w http.ResponseWriter, r *http.Request) {
	httpx.Success(w, http.StatusOK, h.app.WebRTC.Status(), "", nil)
}

func (h *Handler) webrtcStart(w http.ResponseWriter, r *http.Request) {
	var body webrtcStartBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	connection, err := h.resolveRequestConnection(map[string]any{
		"profileId": body.ProfileID,
		"adbPath":   body.ADBPath,
		"address":   body.Address,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	request := webrtcStartRequest(body)
	if request.ADBPath == "" {
		request.ADBPath = connection.ADBPath
	}
	if request.Address == "" {
		request.Address = connection.Address
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	run, replayed, err := h.executeTrackedOperation(ctx, "webrtc_start", map[string]any{
		"profileId": body.ProfileID, "adbPath": request.ADBPath, "address": request.Address, "deviceId": request.DeviceID,
	}, map[string]any{"taskName": "启动实时预览", "taskType": "preview"}, idempotencyKey(r), func(actionCtx context.Context) (any, error) {
		status, startErr := h.app.WebRTC.Start(actionCtx, request)
		if startErr != nil {
			return nil, startErr
		}
		return status, nil
	})
	if err != nil {
		if run.State == agentrun.StatusFailed || run.State == agentrun.StatusInterrupted {
			sendRunFailureResponse(w, run)
			return
		}
		writeError(w, err)
		return
	}
	status := structMap(run.Result)
	deviceID, _ := status["deviceId"].(string)
	status["protocol"] = map[string]any{
		"websocket":           "/webrtc-signaling/connect_client?token=",
		"connectMessage":      map[string]any{"message_type": "connect", "device_id": deviceID},
		"requestOfferPayload": map[string]any{"type": "request-offer", "ip_preference": "ipv4"},
		"candidatePolicy":     "relay preferred / ipv4",
	}
	sendRunResponseMessage(w, run, replayed, false, status, "WebRTC 预览已启动")
}

func (h *Handler) webrtcStop(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if err := h.app.WebRTC.Stop(ctx); err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, h.app.WebRTC.Status(), "WebRTC 预览已停止", nil)
}

func (h *Handler) webrtcDevices(w http.ResponseWriter, r *http.Request) {
	connection, err := h.resolveRequestConnectionFor(r, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	devices, err := h.app.WebRTC.DevicesWithConnection(ctx, connection.ADBPath)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, map[string]any{"devices": devices}, "", nil)
}

func (h *Handler) webrtcSnapshot(w http.ResponseWriter, r *http.Request) {
	deviceID := r.URL.Query().Get("deviceId")
	connection, err := h.resolveRequestConnectionFor(r, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	snapshot, err := h.app.WebRTC.SnapshotWithConnection(ctx, deviceID, connection.ADBPath, connection.Address)
	if err != nil {
		httpx.Failure(w, http.StatusNotFound, &httpx.APIError{
			Code: "WEBRTC_SNAPSHOT_UNAVAILABLE", Message: "无法读取设备快照，请确认设备已连接",
			Retryable: true, Details: map[string]any{"deviceId": deviceID},
		})
		return
	}
	httpx.Success(w, http.StatusOK, snapshot, "", nil)
}

func webrtcStartRequest(body webrtcStartBody) webrtcapp.StartRequest {
	return webrtcapp.StartRequest{
		ADBPath:       body.ADBPath,
		Address:       body.Address,
		DeviceID:      body.DeviceID,
		ServerPath:    body.ServerPath,
		ServerVersion: body.ServerVersion,
		MaxSize:       body.MaxSize,
		MaxFPS:        body.MaxFPS,
		BitRate:       body.BitRate,
	}
}
