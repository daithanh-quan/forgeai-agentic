# Rust Profile

Use this profile when the repository is a Rust application or library.

## Stack signals

- `Cargo.toml` at the project root
- `Cargo.lock` alongside `Cargo.toml`

## Agent focus

- Follow ownership, borrowing, and lifetime rules.
- Keep public API surface (`pub`) minimal and intentional.
- Use `cargo clippy` to catch idiomatic issues before tests.
- Treat compiler errors as required reading — do not suppress with `#[allow]`
  without a documented reason.
- Check `Cargo.toml` features and workspace configuration when adding
  dependencies.

## Validation

```bash
cargo build
cargo clippy -- -D warnings
cargo test
```

## Context exclusion hints

These paths are excluded from selected and compiled context unless explicitly
overridden with `--include-excluded`:

- `target/` — Rust build output
- `**/tests/fixtures/**` — test fixtures
