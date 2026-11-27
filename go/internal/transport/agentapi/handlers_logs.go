package agentapi

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/mps233/la-pluma/go/internal/transport/httpx"
)

func (h *Handler) recentLogs(w http.ResponseWriter, r *http.Request) {
	lines := parseBoundedInt(r.URL.Query().Get("lines"), 80, 1, 500)
	after, _ := strconv.ParseInt(r.URL.Query().Get("afterSequence"), 10, 64)
	httpx.Success(w, http.StatusOK, h.app.Logs.RecentAfter(lines, after), "", nil)
}

func (h *Handler) clearLogs(w http.ResponseWriter, r *http.Request) {
	h.app.Logs.Clear()
	httpx.Success(w, http.StatusOK, map[string]any{"cleared": true}, "日志已清空", nil)
}

func (h *Handler) maaCallbacks(w http.ResponseWriter, r *http.Request) {
	lines := parseBoundedInt(r.URL.Query().Get("lines"), 2000, 1, 5000)
	logPath := filepath.Join(h.app.Config().Paths.MaaStateDir, "debug", "asst.log")
	data, err := readFileTail(logPath, maaCallbackTailBytes)
	if err != nil {
		httpx.Failure(w, http.StatusNotFound, &httpx.APIError{Code: "AGENT_MAA_LOG_UNAVAILABLE", Message: "无法读取 MAA 日志", Retryable: true, Details: map[string]any{"logPath": logPath}})
		return
	}
	all := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	// A tail read can start mid-line; drop that fragment so every returned line parses.
	if len(all) > 0 && !strings.Contains(all[0], "Assistant::append_callback") && len(all) > 1 {
		all = all[1:]
	}
	if len(all) > lines {
		all = all[len(all)-lines:]
	}
	payload := map[string]any{
		"content":       strings.Join(all, "\n"),
		"logPath":       logPath,
		"totalLines":    len(all),
		"returnedLines": len(all),
	}
	// The newest sanity reading can sit far behind the tail (it is written during fights), so it is
	// scanned on its own rather than left to the caller to find inside `content`.
	if reading, ok, err := h.app.MAAService.LatestSanity(r.Context()); err == nil && ok {
		payload["sanity"] = reading
	}
	httpx.Success(w, http.StatusOK, payload, "", nil)
}

// readFileTail returns at most the last maxBytes of path.
func readFileTail(path string, maxBytes int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	size := info.Size()
	offset := int64(0)
	if size > maxBytes {
		offset = size - maxBytes
	}
	if _, err := file.Seek(offset, 0); err != nil {
		return nil, err
	}
	return io.ReadAll(file)
}

func (h *Handler) logFiles(w http.ResponseWriter, r *http.Request) {
	dir := filepath.Join(h.app.Config().Paths.MaaStateDir, "debug")
	files := make([]map[string]any, 0)
	_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() || !strings.HasSuffix(info.Name(), ".log") {
			return nil
		}
		files = append(files, map[string]any{
			"name":     info.Name(),
			"path":     path,
			"size":     info.Size(),
			"modified": info.ModTime().UTC().Format(time.RFC3339),
		})
		return nil
	})
	sort.Slice(files, func(i, j int) bool {
		left, _ := files[i]["modified"].(string)
		right, _ := files[j]["modified"].(string)
		return left > right
	})
	httpx.Success(w, http.StatusOK, files, "", nil)
}

func (h *Handler) readLogFile(w http.ResponseWriter, r *http.Request) {
	dir := filepath.Join(h.app.Config().Paths.MaaStateDir, "debug")
	requested := r.PathValue("filePath")
	path := requested
	if !filepath.IsAbs(path) {
		path = filepath.Join(dir, requested)
	}
	cleanDir := filepath.Clean(dir) + string(os.PathSeparator)
	if !strings.HasPrefix(filepath.Clean(path), cleanDir) {
		httpx.Failure(w, http.StatusBadRequest, &httpx.APIError{Code: "AGENT_LOG_PATH_INVALID", Message: "日志路径不合法", Retryable: false})
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		httpx.Failure(w, http.StatusNotFound, &httpx.APIError{Code: "AGENT_MAA_LOG_UNAVAILABLE", Message: "日志文件不存在", Retryable: false})
		return
	}
	lines := parseBoundedInt(r.URL.Query().Get("lines"), 1000, 1, 5000)
	all := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	total := len(all)
	if len(all) > lines {
		all = all[total-lines:]
	}
	httpx.Success(w, http.StatusOK, map[string]any{
		"path": path, "content": strings.Join(all, "\n"), "totalLines": total, "returnedLines": len(all),
	}, "", nil)
}

func (h *Handler) cleanupLogs(w http.ResponseWriter, r *http.Request) {
	body := decodeBody(r)
	maxMB := intField(body, "maxSizeMB")
	if maxMB <= 0 {
		maxMB = 10
	}
	dir := filepath.Join(h.app.Config().Paths.MaaStateDir, "debug")
	type logFile struct {
		path    string
		size    int64
		modTime time.Time
	}
	files := make([]logFile, 0)
	var total int64
	_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() || !strings.HasSuffix(info.Name(), ".log") {
			return nil
		}
		files = append(files, logFile{path: path, size: info.Size(), modTime: info.ModTime()})
		total += info.Size()
		return nil
	})
	sort.Slice(files, func(i, j int) bool { return files[i].modTime.Before(files[j].modTime) })
	limit := int64(maxMB) * 1024 * 1024
	removed := 0
	var freed int64
	for _, file := range files {
		if total <= limit {
			break
		}
		if err := os.Remove(file.path); err == nil {
			removed++
			freed += file.size
			total -= file.size
		}
	}
	httpx.Success(w, http.StatusOK, map[string]any{"removed": removed, "freedBytes": freed, "remainingBytes": total}, "日志清理完成", nil)
}
