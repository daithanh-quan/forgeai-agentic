---
name: nextjs-implementation
description: Implement Next.js changes with correct routing, rendering boundaries, validation, and framework conventions.
---

# Next.js Implementation

Use this skill for changes in a Next.js project.

## Checklist

- Identify whether the code belongs in `app/`, `pages/`, `components/`,
  `lib/`, route handlers, middleware, or server actions.
- Preserve Server Component and Client Component boundaries.
- Do not add `"use client"` unless browser APIs, hooks, or client state are
  actually required.
- Keep secrets, database calls, and privileged APIs on the server side.
- Check loading, error, not-found, and metadata behavior when route behavior
  changes.
- Validate with the project's existing lint, typecheck, test, and build
  scripts when available.
