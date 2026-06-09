package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// JSON writes v as a JSON response with the given status code.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("encode response", "err", err)
	}
}

// ErrorJSON writes a standardised error envelope.
func ErrorJSON(w http.ResponseWriter, message string, status int) {
	JSON(w, status, map[string]string{"error": message})
}

// DecodeJSON reads and decodes JSON from the request body into dst.
// Returns false and writes a 400 response on failure.
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MB limit
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		ErrorJSON(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return false
	}
	return true
}
