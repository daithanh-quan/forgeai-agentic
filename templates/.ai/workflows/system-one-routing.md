# System One Routing

Use this workflow when a model can inspect state and return calibrated atomic
probabilities. The model does not choose the final route and does not produce a
written justification. Code composes its typed decisions.

Ask these seven questions independently against the same state:

- `mechanical`: Is the operation fully mechanical?
- `bounded_context`: Is all required context already present and narrowly bounded?
- `deterministic_output`: Is the expected output shape deterministic?
- `cheap_verification`: Can correctness be checked cheaply and automatically?
- `ambiguous`: Does any material requirement need interpretation?
- `high_risk`: Can a wrong answer affect security, money, persistent data, or production?
- `requires_synthesis`: Must multiple facts be combined into a new design or explanation?

Each answer must contain `probability` and calibrated `confidence`, both from 0
to 1. Save them in this shape:

```json
{
  "signals": {
    "mechanical": { "probability": 0.99, "confidence": 0.98 },
    "bounded_context": { "probability": 0.99, "confidence": 0.98 },
    "deterministic_output": { "probability": 0.99, "confidence": 0.98 },
    "cheap_verification": { "probability": 0.99, "confidence": 0.98 },
    "ambiguous": { "probability": 0.01, "confidence": 0.98 },
    "high_risk": { "probability": 0.01, "confidence": 0.98 },
    "requires_synthesis": { "probability": 0.01, "confidence": 0.98 }
  }
}
```

Run `forgeai-init --system-one-route --signals <file>`. Only `answer_now` may
use the direct tier. `fast` gets bounded low reasoning. `deliberate` escalates
to standard reasoning. Any failed direct validation escalates once; it must not
loop at the same tier.

The composer shrinks low-confidence probabilities toward 0.5, calculates a
conservative union-bound estimate instead of assuming independence, measures
binary entropy, and applies hard vetoes for risk, ambiguity, synthesis, and
expensive verification.
