# Node API Profile

Use this profile when the repository is a Node.js backend API.

## Stack signals

- `express`, `fastify`, `@nestjs/*`, `hono`, or similar server dependencies
- API route/controller directories
- Server entry points such as `src/server.ts`, `src/app.ts`, or `src/index.ts`

## Agent focus

- Keep request validation close to API boundaries.
- Preserve response contracts and error shapes.
- Update specs or OpenAPI docs when public API behavior changes.
- Add integration tests for route behavior when practical.
- Treat auth, rate limiting, logging, and input parsing as boundary concerns.

## Validation

Prefer existing scripts from `package.json`. Common commands:

```bash
npm run lint
npm run typecheck
npm test
```
