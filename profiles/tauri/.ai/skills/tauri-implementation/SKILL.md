---
name: tauri-implementation
description: Implement Tauri changes across frontend and Rust command boundaries safely.
---

# Tauri Implementation

Use this skill for Tauri desktop app changes.

## Checklist

- Identify whether the change belongs in the frontend, Rust command layer, or
  Tauri configuration.
- Treat commands, permissions, file paths, and shell access as security
  boundaries.
- Keep IPC payloads explicit and typed where possible.
- Validate both frontend and Rust sides when behavior crosses the boundary.
- Avoid broad permission changes unless the task explicitly requires them.
