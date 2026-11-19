package skland

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
)

func TestStatusReportsAutoRefresh(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(config.Paths{DataDir: dir})
	if err := store.SaveCredentials(Credentials{
		Cred: "cred", Token: "token", UID: "uid", Account: "phone", Password: "secret",
	}); err != nil {
		t.Fatalf("save credentials: %v", err)
	}
	service := NewService(Options{Paths: config.Paths{DataDir: dir}, Logger: slog.Default()})
	status, err := service.Status()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if !status.AutoRefresh {
		t.Fatal("password-backed credentials should report auto refresh")
	}
	if status.UID != "uid" {
		t.Fatalf("uid = %q", status.UID)
	}
}

func TestSignRequestMatchesMowerFormat(t *testing.T) {
	got := signRequest("test-token", "/api/v1/game/player/binding", "", 1700000000)
	if got != "69175353eb096a8a756e985b2bc15b6e" {
		t.Fatalf("signature = %s", got)
	}
	if other := signRequest("test-token", "/api/v1/game/cultivate/player", "uid=1", 1700000000); other == got {
		t.Fatal("query must participate in the signature")
	}
}

func TestServiceSyncAndCredentialStorage(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 11, 17, 0, 0, 0, 0, time.UTC)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("cred") != "cred-1" {
			t.Errorf("cred header = %q", r.Header.Get("cred"))
		}
		if r.Header.Get("sign") == "" || len(r.Header.Get("sign")) != 32 {
			t.Errorf("sign header = %q", r.Header.Get("sign"))
		}
		if r.Header.Get("platform") != "" || r.Header.Get("vName") != "" {
			t.Errorf("unexpected signing headers: %v", r.Header)
		}
		switch r.URL.Path {
		case "/api/v1/game/player/binding":
			writeEnvelope(t, w, map[string]any{
				"list": []any{map[string]any{
					"appCode":    "arknights",
					"defaultUid": "uid-1",
					"bindingList": []any{map[string]any{
						"uid":         "uid-1",
						"channelName": "官服",
						"nickname":    "Dr. Test",
						"isOfficial":  true,
					}},
				}},
			})
		case "/api/v1/game/cultivate/player":
			if r.URL.Query().Get("uid") != "uid-1" {
				t.Errorf("cultivate uid = %q", r.URL.Query().Get("uid"))
			}
			writeEnvelope(t, w, map[string]any{
				"characters": []any{
					map[string]any{
						"id": "char_1", "name": "测试干员", "evolvePhase": 2, "level": 60,
						"skills": []any{map[string]any{"id": "sk1", "level": 2}, map[string]any{"id": "sk2", "level": 0}},
					},
					map[string]any{
						"id": "char_2", "name": "教练", "evolvePhase": 2, "level": 60,
						"skills": []any{},
					},
				},
			})
		case "/api/v1/game/player/info":
			writeEnvelope(t, w, map[string]any{
				"status": map[string]any{
					"name": "Dr. Test",
					"ap": map[string]any{
						"current":              66,
						"max":                  135,
						"completeRecoveryTime": time.Now().Add(69 * 6 * time.Minute).Unix(),
					},
				},
				"building": map[string]any{"training": map[string]any{
					"trainee":    map[string]any{"charId": "char_1", "targetSkill": 0},
					"trainer":    map[string]any{"charId": "char_2"},
					"remainSecs": 3600,
					"slotState":  1,
				}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	service := NewService(Options{
		Paths:   config.Paths{DataDir: dir},
		BaseURL: server.URL,
		Now:     func() time.Time { return now },
	})
	status, err := service.SaveCredentials(context.Background(), "cred-1", "token-1", "")
	if err != nil {
		t.Fatalf("save credentials: %v", err)
	}
	if !status.Configured || status.UID != "uid-1" || status.Channel != "官服" {
		t.Fatalf("unexpected status: %+v", status)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "user-configs", "skland.json"))
	if err != nil {
		t.Fatalf("read stored credentials: %v", err)
	}
	if strings.Contains(string(raw), "token-1") || strings.Contains(string(raw), "cred-1") {
		t.Fatal("credential file must not contain plaintext values")
	}

	status, err = service.Sync(context.Background())
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if status.CharacterCount != 2 || status.Training == nil {
		t.Fatalf("unexpected synced status: %+v", status)
	}
	snapshot, ok, err := service.Snapshot()
	if err != nil || !ok {
		t.Fatalf("snapshot: %v %v", ok, err)
	}
	if snapshot.Nickname != "Dr. Test" || snapshot.FetchedAt == "" {
		t.Fatalf("unexpected snapshot: %+v", snapshot)
	}
	if snapshot.Training.TraineeName != "测试干员" || snapshot.Training.TrainerName != "教练" {
		t.Fatalf("training names not resolved: %+v", snapshot.Training)
	}
	if snapshot.Training.RemainSecs != 3600 || snapshot.Training.SlotState != 1 {
		t.Fatalf("unexpected training state: %+v", snapshot.Training)
	}
	if len(snapshot.Characters) != 2 || len(snapshot.Characters[0].Skills) != 2 || snapshot.Characters[0].Skills[0].Level != 2 {
		t.Fatalf("unexpected characters: %+v", snapshot.Characters)
	}
	trainingState, ok, err := service.Training(context.Background())
	if err != nil || !ok {
		t.Fatalf("training probe: %v %v", ok, err)
	}
	if trainingState.TraineeID != "char_1" || trainingState.TraineeName != "测试干员" || trainingState.RemainSecs != 3600 {
		t.Fatalf("unexpected training probe: %+v", trainingState)
	}
	if snapshot.Sanity == nil || snapshot.Sanity.Current != 66 || snapshot.Sanity.Max != 135 {
		t.Fatalf("unexpected sanity snapshot: %+v", snapshot.Sanity)
	}
	if status.Sanity == nil || status.Sanity.Current != 66 || status.Sanity.Max != 135 {
		t.Fatalf("unexpected status sanity: %+v", status.Sanity)
	}

	if err := service.ClearCredentials(); err != nil {
		t.Fatalf("clear credentials: %v", err)
	}
	status, err = service.Status()
	if err != nil || status.Configured || status.CharacterCount != 0 {
		t.Fatalf("credentials not cleared: %+v %v", status, err)
	}
}

func writeEnvelope(t *testing.T, w http.ResponseWriter, data any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]any{"code": 0, "message": "ok", "data": data}); err != nil {
		t.Errorf("encode envelope: %v", err)
	}
}
