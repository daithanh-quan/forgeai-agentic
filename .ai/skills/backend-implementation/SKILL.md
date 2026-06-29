---
name: backend-implementation
description: Use this skill when implementing backend APIs, services, database queries, auth, transactions, integrations, webhooks, or server-side business logic.
---

# Backend Implementation Skill

## Purpose

Implement backend changes safely with clear API contracts, validation, error handling, and data consistency.

## Read First

- `.ai/PROJECT.md`
- `.ai/RULES.md`
- `.ai/MEMORY.md`
- Relevant OpenSpec change if available.

## Workflow

### 1. Define contract

Before coding, identify:

- Endpoint/event/job name.
- Input shape.
- Output shape.
- Auth requirement.
- Error cases.
- Database tables/entities touched.

### 2. Validate at boundary

Validate:

- Request body.
- Query params.
- Path params.
- User/session permissions.

### 3. Keep business logic in service layer

Route/controller should:

- Parse input.
- Call service.
- Return response.

Service should:

- Enforce business rules.
- Manage transaction if needed.
- Coordinate repositories/external APIs.

### 4. Transaction rule

Use transaction when one business operation writes multiple records that must succeed/fail together.

Do not perform destructive migration or data deletion without explicit human approval.

### 5. External integration rule

For Jira/Bitbucket/GitHub/Notion/Trello integrations:

- Keep provider-specific code isolated.
- Normalize external payload before using internally.
- Store external IDs separately from internal IDs.
- Handle rate limit/retry/error states.

### 6. Error handling

Return safe errors to client. Log internal details server-side only.

## Validation

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Output Checklist

- [ ] API contract clear.
- [ ] Input validation exists.
- [ ] Permission/auth checked.
- [ ] Transaction considered.
- [ ] Errors are safe.
- [ ] Tests or manual validation documented.
