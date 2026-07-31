# SvelteKit Change Workflow

Use this workflow for feature, bug, or refactor work in a SvelteKit application.

1. Locate the route, its parent layouts, and any related `$lib` modules.
2. Identify the server/browser boundary and current rendering mode.
3. Select the appropriate SvelteKit primitive: load function, form action,
   endpoint, hook, or component.
4. Implement the smallest change while preserving route data and error contracts.
5. Check accessibility, progressive enhancement, loading, and empty states.
6. Run the project's check, lint, test, and build scripts.
