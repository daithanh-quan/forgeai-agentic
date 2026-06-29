# Audit Task Template

## Required Fields

- Audit scope.
- Risk category: `security | performance | accessibility | dependency | data | process | other`.
- Evidence sources.
- Required output format.

## Lifecycle Emphasis

- In `planning`, define severity labels and false-positive handling.
- In `execution`, collect evidence without changing code unless authorized.
- In `review`, validate that findings are reproducible and scoped.
- In `delivery`, list findings by severity with file/line references when
  applicable.
