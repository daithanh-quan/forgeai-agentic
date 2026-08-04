# Django Profile

Use this profile when the repository is a Django application.

## Stack signals

- `django` in `requirements.txt`, `pyproject.toml`, or `Pipfile`

## Agent focus

- Follow Django's app, model, view, URL, and template conventions.
- Run migrations explicitly — never auto-apply in code.
- Keep business logic in models and services, not in views or serializers.
- Check DRF serializers and viewsets when touching REST endpoints.
- Validate with `manage.py test` or `pytest-django`.

## Validation

```bash
python manage.py check
python manage.py test
# or
pytest
```

## Context exclusion hints

These paths are excluded from selected and compiled context unless explicitly
overridden with `--include-excluded`:

- `migrations/` — auto-generated migrations
- `__pycache__/` — Python bytecode cache
- `.env` — environment secrets
- `staticfiles/` — collected static assets
- `media/` — user-uploaded media
