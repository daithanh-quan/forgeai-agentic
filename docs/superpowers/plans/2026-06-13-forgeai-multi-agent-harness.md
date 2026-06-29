# ForgeAI Multi-Agent Harness Upgrade Implementation Plan

This plan is split into smaller modules so each area can be reviewed and
updated independently.

## Modules

1. [Overview and File Structure](2026-06-13-forgeai-multi-agent-harness/00-overview.md)
2. [Agent Registry and Bootstrap](2026-06-13-forgeai-multi-agent-harness/01-registry-bootstrap.md)
3. [Agent Roles](2026-06-13-forgeai-multi-agent-harness/02-agent-roles.md)
4. [Skills and Root Pointers](2026-06-13-forgeai-multi-agent-harness/03-skills-root-pointers.md)
5. [Project Context](2026-06-13-forgeai-multi-agent-harness/04-project-context.md)
6. [After Initialization and Phase 1 Closeout](2026-06-13-forgeai-multi-agent-harness/05-after-init-closeout.md)
7. [Phase 3 CodeGraph Context Support](2026-06-13-forgeai-multi-agent-harness/06-codegraph-context.md)

## Current Status

Phase 1 is complete. The closeout and verification commands live in
[05-after-init-closeout.md](2026-06-13-forgeai-multi-agent-harness/05-after-init-closeout.md).
Phase 2 is complete with the agentic lifecycle foundation: lifecycle states,
task journals, task-type templates, stale-task detection guidance, closure
rules, `forgeai-init --check-lifecycle`, and a Claude-native planner/spec
wrapper.
Phase 3 is complete with CodeGraph/context graph support for large legacy
projects: `.ai/codegraph/` artifacts, graph-guided context-pack workflow,
bootstrap/read-order integration, `forgeai-init --check-codegraph`, and tests.
