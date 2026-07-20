---
name: fastapi-implementation
description: Implement FastAPI changes with Pydantic schemas, dependency injection, and route contract preservation.
---

# FastAPI Implementation

Use this skill for changes in a FastAPI project.

## Checklist

- Define request and response shapes as Pydantic models, not raw dicts.
- Preserve existing route paths, HTTP methods, and status codes unless the
  task is an intentional breaking change.
- Use `Depends()` for database sessions, auth, and shared clients.
- Update or add `pytest` tests that call the route through `TestClient`.
- Run `pytest` and confirm all tests pass.
- Run `mypy .` and `ruff check .` when available.
