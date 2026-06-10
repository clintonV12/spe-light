package handlers

import (
	"net/http"
	"spe-light/internal/response"
	"time"
)

// GET /health
func Health(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"time":   time.Now().UTC(),
	})
}
