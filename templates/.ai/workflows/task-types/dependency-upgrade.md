# Dependency Upgrade Task Template

## Required Fields

- Dependency name and current version.
- Target version or allowed range.
- Reason for upgrade.
- Changelog or migration notes.
- Affected runtime/build/test areas.

## Lifecycle Emphasis

- In `triage`, identify security urgency and breaking-change risk.
- In `planning`, inspect changelogs and lockfile/package-manager behavior.
- In `execution`, keep unrelated dependency churn out of scope.
- In `validation`, run tests that cover the dependency's integration points.
- In `memory-update`, record new version constraints or migration lessons only
  when they affect future work.
