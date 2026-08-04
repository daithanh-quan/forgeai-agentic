# Python API Profile

Use this profile when the repository is a Python backend API.

## Stack signals

- `pyproject.toml`, `requirements.txt`, `uv.lock`, `poetry.lock`, or
  `Pipfile`
- `fastapi`, `django`, `flask`, `litestar`, or similar API dependencies

## Agent focus

- Keep request validation and serialization explicit.
- Preserve route contracts and status codes.
- Check dependency manager before installing or running commands.
- Prefer existing formatter, linter, type checker, and test commands.
- Update migration or schema files only when required.

## Validation

Prefer existing project commands. Common commands:

```bash
pytest
ruff check .
mypy .
```

## Context exclusion hints

These paths are excluded from selected and compiled context unless explicitly
overridden with `--include-excluded`:

- `__pycache__/` — Python bytecode cache
- `.env` — environment secrets
- `*.pyc` — Python bytecode
- `.venv/` — virtual environment
- `venv/` — virtual environment
