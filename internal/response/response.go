package response

import (
	"encoding/json"
	"net/http"
)

type APIResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message,omitempty"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

func JSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(payload); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func SuccessJSON(w http.ResponseWriter, message string, data interface{}, status int) {
	JSON(w, status, APIResponse{
		Success: true,
		Message: message,
		Data:    data,
	})
}

func ErrorJSON(w http.ResponseWriter, message string, status int) {
	JSON(w, status, APIResponse{
		Success: false,
		Error:   message,
	})
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
