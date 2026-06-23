# Next.js Change Workflow

Use this workflow for feature, bug, or refactor work in a Next.js app.

1. Locate the affected route and rendering boundary.
2. Identify server-only and client-only dependencies.
3. Update route handlers, server actions, or UI components in the smallest
   scope that satisfies the task.
4. Check accessibility, loading, error, and empty states for UI changes.
5. Run relevant validation commands from `package.json`.
