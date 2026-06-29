# OpenSpec-style Workflow

This folder stores durable planning artifacts for AI-assisted development.

Inspired by spec-driven development: agree on what to build before implementation, keep specs in the repo, and archive completed changes.

## Structure

```text
openspec/
  README.md
  project.md
  changes/
    <change-id>/
      proposal.md
      design.md
      tasks.md
      specs/
        <capability>.md
  archive/
```

## Workflow

1. Create change folder.
2. Write proposal.
3. Write design if architecture or trade-off matters.
4. Write tasks.
5. Implement tasks.
6. Validate.
7. Archive completed change.

## When to create a change

Create a change for:

- New feature.
- FE + BE task.
- Database change.
- Auth/payment/security change.
- Refactor with behavior risk.

Use mini spec only for small bug fix.
