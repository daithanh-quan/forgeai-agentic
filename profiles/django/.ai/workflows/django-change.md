# Django Change Workflow

Use this workflow for feature, bug, or refactor work in a Django project.

1. Identify the affected app, model, view, and URL route.
2. Check whether the change requires a schema migration.
3. Update model, serializer, view, URL pattern, and tests together.
4. Run `manage.py makemigrations` and review the generated migration if the
   schema changed.
5. Run `python manage.py check` then `python manage.py test` (or `pytest`).
