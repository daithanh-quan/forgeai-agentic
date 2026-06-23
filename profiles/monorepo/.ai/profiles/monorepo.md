# Monorepo Profile

Use this profile when the repository contains multiple packages or apps.

## Stack signals

- `pnpm-workspace.yaml`, `lerna.json`, `turbo.json`, `nx.json`, or Yarn/npm
  workspaces
- `packages/`, `apps/`, or similar workspace directories

## Agent focus

- Identify the affected package before editing shared code.
- Respect package boundaries and dependency direction.
- Prefer workspace-aware scripts.
- Check whether a change requires coordinated updates across packages.
- Avoid editing unrelated packages during narrow tasks.

## Validation

Prefer workspace scripts. Common commands:

```bash
npm test
pnpm test
npx turbo run test --filter <package>
```
