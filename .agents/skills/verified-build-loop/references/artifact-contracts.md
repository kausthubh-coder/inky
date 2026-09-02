# Artifact contracts

## Master plan

Keep the master plan navigable. It needs the outcome, product boundary, settled decisions, current-state audit, target processes and trust boundaries, state ownership, main runtime flows, package dependency graph, release gate, and sources. Add detail only where it changes a package decision.

## Package dossier

Use this shape as a guide, not a reason to fill empty sections:

```yaml
id: WP-00
status: draft
outcome: one observable result
value_path: how the user or maintainer reaches it
depends_on: []
owns: []
does_not_touch: []
data_shape: core model and mutable-state owner
boundaries: []
reuse_or_delete: []
simplicity_constraints: []
explicitly_not_building: []
implementation_units: []
risks:
  - risk: current costly failure
    proof: cheapest real check
pass_when: []
fail_when: []
evidence: []
debug_order: []
```

Do not add sections, tests, or hypothetical failures just to make the dossier look complete. Gates name an observable value, event, UI state, durable record, or external effect.

## Role reports

Keep reports short and factual.

The implementer records behavior changed, production and test files changed, commands with exit codes, failed attempts, subtraction performed, and work deliberately omitted.

The tester records the app build used, user steps, provider or site involved, observed results, retained screenshots or logs when useful, the smallest reproduction, and anything the environment could not test. It states that production code, automated tests, and fixtures were untouched.

The reviewer records a quality score out of 10, concrete blockers, useful follow-ups, reader-load assessment, unnecessary code found, and its verdict. For a failed live test it also records the likely cause and focused repair instructions. It states that files were untouched.

## Evidence ledger

Record the working-tree fingerprint, commands and exit codes, relevant fixture or runtime, retained logs or screenshots, real failures and fixes, reviewer verdict, and uncovered limitations. Do not preserve repetitive logs whose result is already captured by a stable command and exit code.

## Package conclusion

The HTML conclusion follows the implementation in causal order:

1. user or system entry;
2. boundary parsing or policy decision;
3. domain operation and state owner;
4. durable write or external effect;
5. UI projection or returned result;
6. named failure behavior;
7. proof.

Also state why the structure is as small as it is, what was removed or deliberately omitted, concrete limitations, and the first debugging entry point. Show only code excerpts needed to explain a decision. Do not inventory files or use snippet volume as evidence of work.

The release conclusion joins package traces into full user journeys and reports only the final relevant evidence.
