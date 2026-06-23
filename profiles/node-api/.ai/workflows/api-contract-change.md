# API Contract Change Workflow

Use this workflow when changing request or response behavior.

1. Identify the public contract and current callers.
2. Document whether the change is backward compatible.
3. Update validation, handler, service, and tests together.
4. Update API docs/specs if present.
5. Include migration or rollout notes for breaking changes.
