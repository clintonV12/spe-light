.PHONY: run build test lint tidy \
        docker-up docker-down docker-logs docker-build \
        migrate-up migrate-down migrate-status \
        ollama-pull-llama3 ollama-pull-mistral \
        web-install web-dev web-build \
        seed

# ── Go ───────────────────────────────────────────────────────────────────────
run:
	go run ./cmd/server

build:
	CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/spe-light ./cmd/server

test:
	go test ./... -v -race -count=1

lint:
	golangci-lint run ./...

tidy:
	go mod tidy

# ── Docker ────────────────────────────────────────────────────────────────────
docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f app

docker-build:
	docker compose build --no-cache app

# ── Database migrations ───────────────────────────────────────────────────────
# Requires golang-migrate: https://github.com/golang-migrate/migrate
DB_URL ?= postgres://stratplan:stratplan@localhost:5432/stratplan?sslmode=disable

migrate-up:
	migrate -path ./migrations -database "$(DB_URL)" up

migrate-down:
	migrate -path ./migrations -database "$(DB_URL)" down 1

migrate-status:
	migrate -path ./migrations -database "$(DB_URL)" version

# ── Ollama models ─────────────────────────────────────────────────────────────
ollama-pull-llama3:
	docker exec $$(docker compose ps -q ollama) ollama pull llama3

ollama-pull-mistral:
	docker exec $$(docker compose ps -q ollama) ollama pull mistral

# ── Frontend ──────────────────────────────────────────────────────────────────
web-install:
	cd web && npm install

web-dev:
	cd web && npm run dev

web-build:
	cd web && npm run build

# ── Dev seed (creates a super_admin for local dev) ────────────────────────────
seed:
	go run ./scripts/seed/main.go