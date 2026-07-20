---
name: django-implementation
description: Implement Django changes with correct app structure, migrations, and test coverage.
---

# Django Implementation

Use this skill for changes in a Django project.

## Checklist

- Identify the affected Django app and its models, views, serializers, and
  URL patterns.
- Create migrations with `manage.py makemigrations` when the database schema
  changes — never edit migration files manually.
- Keep business logic in models or separate service modules, not in views.
- Update or add tests using `TestCase` or `pytest-django` fixtures.
- Run `python manage.py check` and `python manage.py test` (or `pytest`).
- Check DRF serializers and viewsets for REST endpoint changes.
