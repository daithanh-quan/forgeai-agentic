# FastAPI Change Workflow

Use this workflow for feature, bug, or refactor work in a FastAPI project.

1. Identify the affected route and its Pydantic request/response models.
2. Confirm whether the change alters the public route contract.
3. Update the Pydantic model, route handler, service, and `TestClient` tests
   together.
4. Check `alembic` migrations if the database schema changes.
5. Run `pytest` and confirm all tests pass.
6. Run `mypy .` and `ruff check .` when available.
