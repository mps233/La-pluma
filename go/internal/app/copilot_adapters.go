package app

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strconv"

	"github.com/mps233/la-pluma/go/internal/app/copilot"
	"github.com/mps233/la-pluma/go/internal/config"
)

// battleLogTailLimit bounds each read. MaaCore appends many trace lines per
// second, but the latest battle counter and the current stage-load event are
// near the end of the file.
const battleLogTailLimit = 1024 * 1024

// copilotBattleSampler reads MaaCore's own battle counter OCR from asst.log.
// The checkpoint is the log size at task start, so a previous stage's final
// counter cannot leak into the next one.
type copilotBattleSampler struct {
	path string
}

func newCopilotBattleSampler(paths config.Paths) copilotBattleSampler {
	return copilotBattleSampler{path: filepath.Join(paths.MaaStateDir, "debug", "asst.log")}
}

func (s copilotBattleSampler) Checkpoint(context.Context) string {
	info, err := os.Stat(s.path)
	if err != nil {
		return ""
	}
	return strconv.FormatInt(info.Size(), 10)
}

func (s copilotBattleSampler) ReadLogSince(_ context.Context, checkpoint string) string {
	text, err := readBattleLogTail(s.path, checkpoint)
	if err != nil {
		return ""
	}
	return text
}

func (s copilotBattleSampler) SampleBattleProgress(ctx context.Context, checkpoint string, expectedTotal *int) (*copilot.BattleProgress, error) {
	text := s.ReadLogSince(ctx, checkpoint)
	battle := copilot.ParseBattleProgress(text)
	if battle == nil {
		return nil, nil
	}
	if expectedTotal != nil && battle.Total != *expectedTotal {
		return nil, nil
	}
	return battle, nil
}

func readBattleLogTail(path, checkpoint string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	size := info.Size()
	offset := int64(0)
	if parsed, parseErr := strconv.ParseInt(checkpoint, 10, 64); parseErr == nil && parsed > 0 && parsed <= size {
		offset = parsed
	}
	if size-offset > battleLogTailLimit {
		offset = size - battleLogTailLimit
	}
	if offset >= size {
		return "", nil
	}
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	buffer := make([]byte, size-offset)
	read, err := file.ReadAt(buffer, offset)
	if err != nil && err != io.EOF {
		return "", err
	}
	return string(buffer[:read]), nil
}
