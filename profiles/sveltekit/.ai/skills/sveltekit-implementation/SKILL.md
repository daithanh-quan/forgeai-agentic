---
name: sveltekit-implementation
description: Implement SvelteKit changes with correct filesystem routing, server boundaries, data loading, form actions, and rendering behavior.
---

# SvelteKit Implementation

Use this skill for changes in a SvelteKit project.

## Checklist

- Locate the affected route and its nearest `+layout` before changing route files.
- Choose the correct boundary: universal `load`, server `load`, form action,
  `+server` endpoint, hook, or reusable `$lib` module.
- Never import private environment variables or server-only modules into browser code.
- Preserve Svelte reactivity and existing runes/store conventions; do not mix styles
  without a migration requirement.
- Check loading, error, redirect, invalidation, and progressive-enhancement behavior.
- Confirm SSR/prerender settings and the deployment adapter still match the route.
- Run the project's existing check, lint, test, and build scripts when available.
