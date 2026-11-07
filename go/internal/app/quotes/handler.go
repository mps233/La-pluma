package quotes

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

const maxRequestBody = 1 << 20

// Handler serves the /api/operator-quotes routes. Mount it with
// http.StripPrefix("/api/operator-quotes", handler).
//
// The Node routes return raw JSON (not the success/message/data envelope), so
// these handlers do the same to keep the client contract unchanged.
type Handler struct {
	service *Service
	mux     *http.ServeMux
}

// NewHandler builds the quotes router for a service.
func NewHandler(service *Service) *Handler {
	handler := &Handler{service: service, mux: http.NewServeMux()}
	handler.mux.HandleFunc("GET /daily", handler.daily)
	handler.mux.HandleFunc("GET /all", handler.all)
	handler.mux.HandleFunc("GET /random", handler.random)
	handler.mux.HandleFunc("GET /operator/{name}", handler.getByOperator)
	handler.mux.HandleFunc("POST /{$}", handler.add)
	handler.mux.HandleFunc("PUT /operator/{name}", handler.update)
	handler.mux.HandleFunc("DELETE /operator/{name}", handler.delete)
	handler.mux.HandleFunc("/", notFound)
	return handler
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// http.StripPrefix("/api/operator-quotes") leaves an empty path for the
	// mount root. Serve it as "/" instead of letting ServeMux redirect.
	if r.URL.Path == "" {
		clone := r.Clone(r.Context())
		clone.URL.Path = "/"
		r = clone
	}
	h.mux.ServeHTTP(w, r)
}

func (h *Handler) daily(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, h.service.GetDailyQuote())
}

func (h *Handler) all(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, h.service.GetAllQuotes())
}

func (h *Handler) random(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, h.service.GetRandomQuote())
}

func (h *Handler) getByOperator(w http.ResponseWriter, r *http.Request) {
	quote, ok := h.service.GetQuoteByOperator(r.PathValue("name"))
	if !ok {
		writeError(w, http.StatusNotFound, "未找到该干员的台词")
		return
	}
	writeJSON(w, http.StatusOK, quote)
}

func (h *Handler) add(w http.ResponseWriter, r *http.Request) {
	body, ok := decodeBody(w, r)
	if !ok {
		return
	}
	operator, operatorOK := body["operator"].(string)
	quote, quoteOK := body["quote"].(string)
	if !operatorOK || operator == "" || !quoteOK || quote == "" {
		writeError(w, http.StatusBadRequest, "缺少干员名或台词")
		return
	}
	quotes, err := h.service.AddQuote(OperatorQuote{OperatorID: "", Operator: operator, Quote: quote})
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, quotes)
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	body, ok := decodeBody(w, r)
	if !ok {
		return
	}
	quote, quoteOK := body["quote"].(string)
	if !quoteOK || quote == "" {
		writeError(w, http.StatusBadRequest, "缺少台词内容")
		return
	}
	updated, found, err := h.service.UpdateQuote(r.PathValue("name"), quote)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "未找到该干员的台词")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	quotes, err := h.service.DeleteQuote(r.PathValue("name"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, quotes)
}

func decodeBody(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	decoder := json.NewDecoder(io.LimitReader(r.Body, maxRequestBody))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式无效")
		return nil, false
	}
	body, ok := value.(map[string]any)
	if !ok {
		writeError(w, http.StatusBadRequest, "请求格式无效")
		return nil, false
	}
	return body, true
}

func writeServiceError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	message := "服务器内部错误"
	if appErr, ok := apperrors.As(err); ok {
		status = appErr.StatusCode
		message = appErr.Message
	}
	writeError(w, status, message)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func notFound(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotFound, "Not Found")
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		http.Error(w, "服务器内部错误", http.StatusInternalServerError)
		return
	}
	body := bytes.TrimSuffix(buffer.Bytes(), []byte("\n"))
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}
