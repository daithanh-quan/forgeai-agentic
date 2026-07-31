# SvelteKit Profile

Use this profile when the repository is a SvelteKit application.

## Stack signals

- `@sveltejs/kit` dependency in `package.json`
- `svelte.config.js` or `svelte.config.mjs`
- `src/routes/` filesystem routing

## Agent focus

- Follow SvelteKit's `+page`, `+layout`, `+server`, and `+error` routing conventions.
- Keep secrets and privileged APIs in server-only modules, server load functions,
  form actions, hooks, or endpoint handlers.
- Distinguish universal `load` code from `+page.server` and `+layout.server` code.
- Preserve SSR, prerender, and client-side rendering settings when changing routes.
- Reuse SvelteKit form actions, redirects, errors, and data invalidation before
  introducing custom request-state plumbing.
- Check the configured adapter before adding deployment-specific behavior.

## Validation

Prefer existing scripts from `package.json`. Common commands:

```bash
npm run check
npm run lint
npm test
npm run build
```

## Context exclusion hints

Do not include `.svelte-kit/`, `build/`, or `node_modules/` in context.
