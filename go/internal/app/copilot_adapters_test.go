package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/mps233/la-pluma/go/internal/config"
)

func TestCopilotBattleSamplerReadsOnlyNewLogLines(t *testing.T) {
	stateDir := t.TempDir()
	logDir := filepath.Join(stateDir, "debug")
	if err := os.MkdirAll(logDir, 0o700); err != nil {
		t.Fatal(err)
	}
	logPath := filepath.Join(logDir, "asst.log")
	if err := os.WriteFile(logPath, []byte("[TRC] Kills: 99 / 100\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	sampler := newCopilotBattleSampler(config.Paths{MaaStateDir: stateDir})
	checkpoint := sampler.Checkpoint(context.Background())
	if checkpoint == "" {
		t.Fatal("checkpoint must record the existing log size")
	}
	battle, err := sampler.SampleBattleProgress(context.Background(), checkpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	if battle != nil {
		t.Fatalf("a line before the checkpoint must not be read: %#v", battle)
	}

	appendLog := func(line string) {
		t.Helper()
		file, openErr := os.OpenFile(logPath, os.O_APPEND|os.O_WRONLY, 0o600)
		if openErr != nil {
			t.Fatal(openErr)
		}
		if _, writeErr := file.WriteString(line); writeErr != nil {
			_ = file.Close()
			t.Fatal(writeErr)
		}
		if closeErr := file.Close(); closeErr != nil {
			t.Fatal(closeErr)
		}
	}
	appendLog("[TRC] Kills: 11 / 35\n")
	battle, err = sampler.SampleBattleProgress(context.Background(), checkpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	if battle == nil || battle.Kills != 11 || battle.Total != 35 {
		t.Fatalf("battle = %#v", battle)
	}

	appendLog("[TRC] Kills: 12 / 35\n")
	battle, err = sampler.SampleBattleProgress(context.Background(), checkpoint, nil)
	if err != nil || battle == nil || battle.Kills != 12 || battle.Total != 35 {
		t.Fatalf("latest battle = %#v, err = %v", battle, err)
	}

	expected := 36
	if battle, err := sampler.SampleBattleProgress(context.Background(), checkpoint, &expected); err != nil || battle != nil {
		t.Fatalf("a different expected total must be ignored: %#v, err = %v", battle, err)
	}
}
