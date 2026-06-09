# Contributing to StratPlan

Thank you for taking the time to contribute. This document covers everything you need to get started.

---

## Branch strategy

| Branch | Purpose |
|--------|---------|
| `main` | Stable — tagged releases only. Never commit directly. |
| `develop` | Integration branch. All feature branches merge here. |
| `feature/<name>` | New features, e.g. `feature/auth-sso` |
| `fix/<name>` | Bug fixes, e.g. `fix/invite-expiry` |
| `chore/<name>` | Tooling, deps, docs, e.g. `chore/update-go-deps` |

### Typical workflow

```bash
git checkout develop
git pull origin develop
git checkout -b feature/my-feature

# ... do work ...

git push origin feature/my-feature
# Open a pull request → develop
```

---

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]
[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
```
feat(auth): add SAML SSO handler
fix(invite): prevent expired tokens from being accepted
docs(readme): update quick start steps
chore(deps): upgrade go-chi to v5.1.0
```

---

## Pull requests

- Target branch: `develop` (never `main` directly)
- Keep PRs focused — one feature or fix per PR
- Add or update tests for any changed behaviour
- Ensure `make test` and `make lint` pass before requesting review
- Fill in the PR template

---

## Development setup

See [README.md](README.md) for the full local setup guide.

Quick check that everything works:

```bash
make docker-up       # start Postgres + Ollama
make migrate-up      # apply schema
make run             # start server
curl localhost:8080/health   # → {"status":"ok"}
make test            # all tests green
```

---

## Code style

- **Go:** follow `gofmt` + `golangci-lint`. Run `make lint` before pushing.
- **TypeScript/React:** ESLint + Prettier. Run `cd web && npm run lint` before pushing.
- All exported Go functions and types must have a doc comment.
- No magic numbers — use named constants from `internal/models`.

---

## Reporting issues

Use the GitHub issue templates:

- **Bug report** — steps to reproduce, expected vs actual behaviour, logs
- **Feature request** — describe the use case, not just the solution

---