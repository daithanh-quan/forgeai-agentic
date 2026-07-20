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

Do not include `vendor/`, `*.pb.go` (generated protobuf), or `*_mock.go`
(generated mocks) in context unless the task explicitly requires them.
