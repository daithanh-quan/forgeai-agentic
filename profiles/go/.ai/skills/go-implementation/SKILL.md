---
name: go-implementation
description: Implement Go changes with correct package structure, exported identifiers, and test coverage.
---

# Go Implementation

Use this skill for changes in a Go project.

## Checklist

- Identify the affected package and whether changes touch exported or
  unexported identifiers.
- Keep function signatures backward compatible unless the task is a
  deliberate API change.
- Add or update `_test.go` files in the same package for unit tests and in
  a `_test` package for integration tests.
- Run `go vet ./...` to catch common mistakes before running tests.
- Run `go test ./...` and confirm all tests pass.
- Check `go.mod` and `go.sum` after adding or removing dependencies
  (`go mod tidy`).
