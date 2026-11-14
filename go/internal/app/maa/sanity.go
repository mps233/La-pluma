package maa

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"

	"github.com/mps233/la-pluma/go/internal/infra/maa/results"
)

// sanitySearchLimit bounds the backward scan: asst.log can pass 40 MB, and a reading from earlier
// in the session is still within a few MB of the end. A log that has no fight in this window has no
// reading to show.
const sanitySearchLimit = 16 * 1024 * 1024

// LatestSanity returns the newest current/max sanity MaaCore reported. The callback is written
// during fight stages, so it can sit far behind the log tail once the game is idle; the scan walks
// backward and stops at the first SanityBeforeStage line instead of reading the whole file.
func (s *Service) LatestSanity(_ context.Context) (results.SanityReading, bool, error) {
	path := filepath.Join(s.cfg.Paths.MaaStateDir, "debug", "asst.log")
	file, err := os.Open(path)
	if err != nil {
		return results.SanityReading{}, false, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return results.SanityReading{}, false, err
	}

	const chunkSize = 256 * 1024
	end := info.Size()
	var tail []byte
	for end > 0 && int64(len(tail)) < sanitySearchLimit {
		start := end - chunkSize
		if start < 0 {
			start = 0
		}
		buf := make([]byte, end-start)
		if _, err := file.ReadAt(buf, start); err != nil && err != io.EOF {
			return results.SanityReading{}, false, err
		}
		tail = append(buf, tail...)

		if index := bytes.LastIndex(tail, []byte("SanityBeforeStage")); index >= 0 {
			lineStart := bytes.LastIndexByte(tail[:index], '\n') + 1
			lineEnd := len(tail)
			if next := bytes.IndexByte(tail[index:], '\n'); next >= 0 {
				lineEnd = index + next
			}
			if reading, ok := results.LatestSanityState(string(tail[lineStart:lineEnd])); ok {
				return reading, true, nil
			}
		}
		end = start
	}

	return results.SanityReading{}, false, nil
}
