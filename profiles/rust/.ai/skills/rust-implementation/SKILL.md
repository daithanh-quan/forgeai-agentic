---
name: rust-implementation
description: Implement Rust changes with correct ownership, public API surface, and test coverage.
---

# Rust Implementation

Use this skill for changes in a Rust project.

## Checklist

- Understand ownership and lifetimes for any new data structures or function
  signatures.
- Keep `pub` items minimal — only expose what callers actually need.
- Add unit tests in `#[cfg(test)]` modules inside the same file and
  integration tests under `tests/`.
- Run `cargo clippy -- -D warnings` and fix all warnings before committing.
- Run `cargo test` and confirm all tests pass.
- Update `Cargo.toml` and run `cargo check` when adding or removing
  dependencies.
