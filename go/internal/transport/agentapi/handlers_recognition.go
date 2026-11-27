package agentapi

import (
	"context"
	"net/http"
	"time"

	"github.com/mps233/la-pluma/go/internal/domain/agentrun"
	"github.com/mps233/la-pluma/go/internal/transport/httpx"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

func recognitionFailure(err error, code, message string) error {
	if _, ok := apperrors.As(err); ok {
		return err
	}
	return apperrors.WithStatus(code, message, http.StatusInternalServerError, false, map[string]any{"error": err.Error()})
}

func (h *Handler) depotRecognition(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	plan := map[string]any{"action": "depot-recognition", "sideEffects": []string{"parse_maa_logs", "update_local_depot_cache"}}
	if dryRun, _ := body["dryRun"].(bool); dryRun {
		httpx.Success(w, http.StatusOK, map[string]any{"plan": plan}, "Dry run only", map[string]any{"dryRun": true})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	run, replayed, err := h.executeTrackedResult(ctx, "depot_recognition", map[string]any{"action": "depot-recognition"}, map[string]any{"taskName": "仓库识别", "taskType": "statistics"}, idempotencyKey(r), func(ctx context.Context) (any, error) {
		result, err := h.app.Recognition.RecognizeDepot(ctx)
		if err != nil {
			return nil, recognitionFailure(err, "AGENT_DEPOT_RECOGNITION_FAILED", "仓库识别失败")
		}
		return structMap(result.Data), nil
	})
	if err != nil {
		writeError(w, err)
		return
	}
	sendRunResponse(w, run, replayed, false, structMap(run.Result))
}

func (h *Handler) operboxRecognition(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	plan := map[string]any{"action": "operbox-recognition", "sideEffects": []string{"parse_maa_logs", "update_local_operbox_cache"}}
	if dryRun, _ := body["dryRun"].(bool); dryRun {
		httpx.Success(w, http.StatusOK, map[string]any{"plan": plan}, "Dry run only", map[string]any{"dryRun": true})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	run, replayed, err := h.executeTrackedResult(ctx, "operbox_recognition", map[string]any{"action": "operbox-recognition"}, map[string]any{"taskName": "干员识别", "taskType": "statistics"}, idempotencyKey(r), func(ctx context.Context) (any, error) {
		result, err := h.app.Recognition.RecognizeOperBox(ctx)
		if err != nil {
			return nil, recognitionFailure(err, "AGENT_OPERBOX_RECOGNITION_FAILED", "干员识别失败")
		}
		return structMap(result.Data), nil
	})
	if err != nil {
		writeError(w, err)
		return
	}
	sendRunResponse(w, run, replayed, false, structMap(run.Result))
}

func (h *Handler) updateCore(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	version := firstNonEmpty(stringField(body, "version"), "current")
	dryRun, _ := body["dryRun"].(bool)
	if dryRun {
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
		defer cancel()
		outcome, err := h.app.Updates.UpdateCoreAction(ctx, version, true)
		if err != nil {
			writeError(w, err)
			return
		}
		httpx.Success(w, http.StatusOK, outcome.Data, outcome.Message, map[string]any{"dryRun": true})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	run, replayed, err := h.executeTrackedOperation(ctx, "update_core", map[string]any{"version": version}, map[string]any{"taskName": "更新 MaaCore 与资源", "taskType": "maintenance"}, idempotencyKey(r), func(actionCtx context.Context) (any, error) {
		outcome, runErr := h.app.Updates.UpdateCoreAction(actionCtx, version, false)
		if runErr != nil {
			return nil, runErr
		}
		return structMap(outcome.Data), nil
	})
	if err != nil {
		if run.State == agentrun.StatusFailed || run.State == agentrun.StatusInterrupted {
			sendRunFailureResponse(w, run)
			return
		}
		writeError(w, err)
		return
	}
	sendTrackedRunResponse(w, run, replayed, "更新 MaaCore 与资源完成")
}

func (h *Handler) updateCLI(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	dryRun, _ := body["dryRun"].(bool)
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Minute)
	defer cancel()
	outcome, err := h.app.Updates.UpdateCLIAction(ctx, dryRun)
	if err != nil {
		writeError(w, err)
		return
	}
	httpx.Success(w, http.StatusOK, outcome.Data, outcome.Message, map[string]any{"dryRun": outcome.DryRun})
}

func (h *Handler) hotUpdateResources(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	dryRun, _ := body["dryRun"].(bool)
	if dryRun {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Minute)
		defer cancel()
		outcome, err := h.app.Updates.HotUpdateResourcesAction(ctx, true)
		if err != nil {
			writeError(w, err)
			return
		}
		httpx.Success(w, http.StatusOK, outcome.Data, outcome.Message, map[string]any{"dryRun": true})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	run, replayed, err := h.executeTrackedOperation(ctx, "hot_update_resources", map[string]any{"action": "hot-update"}, map[string]any{"taskName": "同步 MAA 资源", "taskType": "maintenance"}, idempotencyKey(r), func(actionCtx context.Context) (any, error) {
		outcome, runErr := h.app.Updates.HotUpdateResourcesAction(actionCtx, false)
		if runErr != nil {
			return nil, runErr
		}
		return structMap(outcome.Data), nil
	})
	if err != nil {
		if run.State == agentrun.StatusFailed || run.State == agentrun.StatusInterrupted {
			sendRunFailureResponse(w, run)
			return
		}
		writeError(w, err)
		return
	}
	sendTrackedRunResponse(w, run, replayed, "资源更新完成")
}
