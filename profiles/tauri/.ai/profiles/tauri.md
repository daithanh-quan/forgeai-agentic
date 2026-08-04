# Tauri Profile

Use this profile when the repository is a Tauri desktop application.

## Stack signals

- `src-tauri/`
- `tauri.conf.*`
- Rust commands invoked from a web frontend

## Agent focus

- Keep frontend UI code separate from Rust command logic.
- Treat Tauri commands as privileged boundaries.
- Validate file system, shell, process, and OS-level permissions carefully.
- Check both frontend build and Rust compilation when behavior crosses the
  boundary.

## Validation

Prefer existing scripts. Common commands:

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Context exclusion hints

These paths are excluded from selected and compiled context unless explicitly
overridden with `--include-excluded`:

- `src-tauri/target/` — Rust build output
- `target/` — Rust build output
