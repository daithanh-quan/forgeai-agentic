# Rust Change Workflow

Use this workflow for feature, bug, or refactor work in a Rust project.

1. Identify the affected crate and module.
2. Check ownership boundaries and whether the change affects public API.
3. Write or update unit tests in `#[cfg(test)]` or integration tests under
   `tests/`.
4. Run `cargo clippy -- -D warnings` and fix all warnings.
5. Run `cargo test` and confirm all tests pass.
6. Update `Cargo.toml` and run `cargo check` when dependencies change.
