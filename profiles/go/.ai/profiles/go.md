# Go Profile

Use this profile when the repository is a Go application or library.

## Stack signals

- `go.mod` at the project root
- `go.sum` alongside `go.mod`

## Agent focus

- Follow module path conventions from `go.mod`.
- Keep package boundaries and exported identifiers explicit.
- Prefer the standard library before adding external dependencies.
- Run `go vet` and `go test ./...` before any change is considered done.
- Check build constraints and platform-specific files when touching OS or
  architecture-sensitive code.

## Validation

```bash
go build ./...
go vet ./...
go test ./...
```

## Context exclusion hints

These paths are excluded from selected and compiled context unless explicitly
overridden with `--include-excluded`:

- `vendor/` — vendored dependencies
- `*.pb.go` — generated protobuf source
- `*_mock.go` — generated mocks
