---
name: monorepo-boundaries
description: Work safely in monorepos by respecting package boundaries, dependency direction, and workspace validation.
---

# Monorepo Boundaries

Use this skill before changing shared packages or cross-package contracts.

## Checklist

- Identify the owning package and downstream consumers.
- Check workspace dependency configuration before importing across packages.
- Keep changes in the smallest set of packages that satisfies the task.
- Update package-level tests and any affected integration tests.
- Use workspace-aware commands when available.
- Document cross-package impact in the final summary.
