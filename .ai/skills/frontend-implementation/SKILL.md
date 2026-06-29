---
name: frontend-implementation
description: Use this skill when implementing or modifying frontend features, React/Next.js components, forms, optimistic UI, marketplace UI, Figma-to-code, or client-side data fetching.
---

# Frontend Implementation Skill

## Purpose

Build frontend changes safely with consistent UI behavior, data fetching, state handling, and validation.

## Read First

- `.ai/PROJECT.md`
- `.ai/RULES.md`
- `.ai/TASTE.md`
- `.ai/MEMORY.md`
- Relevant OpenSpec change if available.

## Workflow

### 1. Understand the UI intent

Identify:

- User action.
- Expected visual result.
- Data source.
- Loading state.
- Error state.
- Empty state.
- Permission/role rules.

### 2. Locate existing patterns

Before creating new code, search for:

- Similar page/container.
- Existing modal/form/table patterns.
- Existing API hooks.
- Existing constants and icon mapping.
- Existing role/permission hooks.

### 3. Implement minimally

Prefer:

- Reusing components.
- Keeping component props explicit.
- Moving complex logic into hooks/helpers.
- Keeping API mutation side effects predictable.

### 4. Optimistic UI rule

For optimistic update:

```ts
const previousValue = currentValue;
applyOptimisticValue();
try {
  await mutation().unwrap();
} catch (error) {
  rollback(previousValue);
  showError(error);
}
```

Never update UI optimistically without a rollback path.

### 5. Form rule

Every form should define:

- Initial values.
- Validation rules.
- Submit loading state.
- Submit error handling.
- Success behavior.

### 6. Validation

Run available commands:

```bash
npm run typecheck
npm run lint
npm test
```

If unavailable, inspect `package.json` and choose equivalent commands.

## Output Checklist

- [ ] UI matches requirement.
- [ ] Handles loading/error/empty states.
- [ ] No unnecessary dependency.
- [ ] TypeScript types are clear.
- [ ] Validation result documented.
