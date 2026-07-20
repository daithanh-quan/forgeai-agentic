# Go Change Workflow

Use this workflow for feature, bug, or refactor work in a Go project.

1. Identify the affected package and its dependents.
2. Check exported identifiers and whether the change is backward compatible.
3. Write or update `_test.go` files alongside the implementation.
4. Run `go vet ./...` to catch vet issues.
5. Run `go test ./...` and confirm all tests pass.
6. Run `go mod tidy` if dependencies changed.
