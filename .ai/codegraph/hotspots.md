# CodeGraph Hotspots

Track code areas that need extra caution before agent edits.

## High-Risk Areas

| Area | Why it is risky | Required checks | Confidence |
| --- | --- | --- | --- |
| `bin/lib/init.ts` (`PRESERVE_ON_UPGRADE_FILES`) | Forgetting to list a new user-tuned file means `--upgrade` silently clobbers user data (happened with `security-policy.yaml` before 2026-07-02 fix) | `test/upgrade.test.ts` preservation tests | high |
| `bin/lib/security.ts` | Supply-chain gate: false negatives let risks through, false positives block CI with no remediation unless a policy exception key exists | `test/security.test.ts`, run `--check-security` on this repo itself | high |
| `templates/.ai/router/run-model.ts` + `bin/lib/model-routing.ts` | Hand-rolled YAML read/write on the same file; a format change in one breaks the other. Delegation spawn has no timeout | `test/router.test.ts`, `test/add-model.test.ts` | high |
| `package.json` `bin` → `dist/forgeai-init.js` | Published bin is compiled output; `dist/` is gitignored and only exists after `npm run build`, so packing without building ships a stale or missing CLI | `test/dist.test.ts`, `prepublishOnly` runs the build via `npm test` | high |
| `templates/` file additions | Every new template file becomes a required file for `--check` in all user repos and must be considered for the preserve list | `test/check.test.ts`, `test/upgrade.test.ts` | high |

## Shared Contracts

| Contract | Producers | Consumers | Compatibility notes |
| --- | --- | --- | --- |
| `.ai/cli-adapters.json` | `--add-model` / `--remove-model`, template default | router `run-model.ts`, `--check`, `--list-models` | Adapter shape: command/args/healthcheck/input/quota_patterns |
| `.ai/model-routing.yaml` | template, `repointTierInYaml` | router `readTier()` | Flat 2-space tier blocks only; both parsers are hand-rolled, no YAML lib |
| `.ai/security-policy.yaml` | template, human-approved exceptions | `--check-security`, agents via RULES.md | Keys: trusted_registries, allowed_install_commands, blocked_shell_patterns, allowed_dependency_exceptions, allowed_path_exceptions. Preserved on upgrade |
| `.ai/manifest.json` | `runInit`/`--upgrade` | update preflight, `--check-profile`, upgrade profile reuse | version/package_version/profile/initialized_at |
| router fallback JSON payload | `run-model.ts` | orchestrator agents parsing delegation results | status/reason/behavior/provider/model/message |

## Legacy Constraints

- No YAML dependency by design: all YAML handling is minimal hand-rolled
  parsing that only supports the flat format shipped in templates. Do not
  introduce nested YAML into routed/policy files.
- ESM-only (`"type": "module"`), Node >= 20. The published CLI is
  compiled JS (`tsconfig.build.json` → `dist/`) with zero runtime
  dependencies outside the package runtime dependencies; tsx is dev-only
  (tests run the TS source through it).
- `package.json#files` publishes only `dist`, `profiles`, `templates`,
  `README.md` — repo-level `bin/` source, `.ai/`, `docs/`, `openspec/`
  are internal and never shipped.
- This repo's `.ai/MEMORY.md` holds the long-term roadmap (phases, pivots)
  and is preserved on upgrade; treat it as the strategic source of truth.
- `--check-all` runs CodeGraph in strict mode: this graph goes stale after
  30 days (`generated_at`) and will fail the aggregate check until refreshed.

## Refresh Notes

- Last refreshed: 2026-07-09
- Refreshed by: Codex during 3.0.0 release-readiness audit
- Evidence read: `bin/ui/*`, router auto-event flow, `templates/` package dry-run, `test/` suite (133 tests), `--check` on this repo
