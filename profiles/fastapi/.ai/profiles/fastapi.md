# FastAPI Profile

Use this profile when the repository is a FastAPI application.

## Stack signals

- `fastapi` in `requirements.txt`, `pyproject.toml`, or `Pipfile`

## Agent focus

- Keep request and response models as Pydantic schemas — never bypass
  validation with raw `dict`.
- Preserve route path, method, and response status codes as the public
  contract.
- Use dependency injection (`Depends`) for shared resources; do not
  instantiate clients or sessions inside route functions.
- Check `alembic` or the configured migration tool before touching database
  schema.
- Validate with `pytest` and check type annotations with `mypy` when
  available.

## Validation

```bash
pytest
mypy .
ruff check .
```

## Context exclusion hints

These paths are excluded from selected and compiled context unless explicitly
overridden with `--include-excluded`:

- `alembic/versions/` — generated migration scripts
- `__pycache__/` — Python bytecode cache
- `.env` — environment secrets
- `*.pyc` — Python bytecode
