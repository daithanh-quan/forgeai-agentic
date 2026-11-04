# Taste and Preferences

This file stores style and preference guidance so AI agents produce output that matches the owner/team.

## Communication style

- Be direct, practical, and avoid unnecessary theory.
- Prefer runnable code examples.
- When there are multiple options, recommend the best option first, then explain trade-offs.
- For large tasks, split work into an initial minimal phase and a production-ready phase.

## Engineering taste

- Follow *First Make it Work, Then Make it Right*: write the failing behavioral test first, ship the smallest edit that passes, then refactor so functions stay small (`complexity < 10`) and free of structural duplication (`similarity < 0.8`).
- Get the data shape right before writing logic; separate state instead of sharing mutable state across concurrent writers.
- Prefer maintainable structure over clever code; subtract complexity before adding new branches.
- Do not over-engineer the initial implementation.
- Move business logic out of UI when the logic becomes complex.
- Use clear names instead of abbreviations.
- Follow the current repository conventions over the agent's personal preferences.

## Frontend taste

- Components should be small and have clear responsibility.
- Loading, error, and empty states are mandatory for data-fetching UI.
- Use optimistic UI when the user experience needs fast feedback, but always support rollback.
- Forms should use schema validation if the project already uses Zod, Yup, React Hook Form, or similar tools.

## Backend taste

- API responses should be consistent.
- Validate input at system boundaries.
- Do not leak internal errors to clients.
- Service layers should contain business logic; controllers/routes should coordinate only.

## Agentic workflow taste

- Human review at the end is mandatory.
- Agents must be able to explain why they chose an approach.
- Difficult tasks should be split into subtasks before coding.
- Model routing: use cheaper/faster models for classification and strong models for architecture, hard refactors, and difficult debugging.
