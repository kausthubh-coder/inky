# Build workflow

## Evidence intake

Read the latest product decisions, repository instructions, current implementation, scripts, and closest tests. Mark assumptions as `settled`, `must validate`, or `deferred`. Research unstable integrations from primary sources.

## Master plan

Plan the end state at system-boundary level:

- process and service ownership;
- mutable state ownership;
- data crossing each boundary;
- handoff and permission decisions;
- start, pause, resume, failure, restart, and recovery flows;
- package dependencies and release gates.

Do not prebuild a framework for future packages. Define a shared contract early only when two known packages need it.

## Package graph

Each package must produce a coherent user-visible or architectural result. Split where a boundary can be tested and debugged alone. Do not split one small change merely to manufacture packages.

Prefer this order:

1. remove obsolete structure;
2. establish the domain shape or boundary needed by later work;
3. implement one complete path;
4. prove that path;
5. integrate a volatile external system only after its consumer contract exists.

## Package dossier

Write the next ready package just in time. Include its value path, data shape, state owner, scope, explicit exclusions, simplicity constraints, current risks, implementation sequence, checks, and completion predicate.

The implementation sequence should be detailed enough to debug in order, but it must leave ordinary code-level choices to the implementer. Do not predict every filename or helper.

## Coding cycle

1. Capture the closest green baseline.
2. Implement the smallest coherent slice.
3. Check it at the nearest meaningful boundary.
4. Continue only if another step is needed for the package outcome.
5. Run the subtraction pass.
6. Run the final package gates.
7. When the package reaches a real app or external boundary, have a separate tester use that path without changing code or adding tests.
8. Run one read-only quality review after the tester. On failure, it diagnoses and briefs the repair. On success, it rates the implementation and blocks only a clearly costly code problem.

A failed gate gets a focused reviewer diagnosis and repair brief. A preference, a merely imperfect score, or an imagined future edge case does not.

## Integration and release

Integration checks cover contracts actually shared by completed packages, restart behavior the app already supports, packaging, secrets, and one representative real-boundary path. Release conclusions join package traces into user journeys. They do not repeat every package report.
