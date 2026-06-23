# Next.js Profile

Use this profile when the repository is a Next.js application.

## Stack signals

- `next` dependency in `package.json`
- `next.config.*`
- `app/` or `pages/` routing

## Agent focus

- Distinguish Server Components, Client Components, Route Handlers, Server
  Actions, middleware, and client-side state.
- Check routing conventions before creating or moving files.
- Keep server-only code out of client components.
- Validate data fetching, caching, metadata, and error/loading states.
- Prefer framework-native primitives before adding dependencies.

## Validation

Prefer existing scripts from `package.json`. Common commands:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```
