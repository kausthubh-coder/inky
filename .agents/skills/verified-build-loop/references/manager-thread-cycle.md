# Manager task cycle

## Manager ownership

The manager owns scope, architecture, the dossier, task briefs, evidence judgment, package status, and the conclusion. It inspects the working tree and does not pass role reports through as fact.

For Studi, every role task uses `gpt-5.6-sol` with high reasoning and normal speed. Stop after the package conclusion for user review.

## Preflight

Before creating an implementer, apply the quality oracle and answer:

- What one outcome makes this package worth shipping?
- What is the simplest data shape that supports it?
- What existing code can be removed or reused?
- Which new layers are forbidden unless evidence changes the plan?
- Which current failures would be costly enough to test?

If the brief cannot answer these, the package is not ready.

## Implementer

Create `WP-NN C1 implement`. Its brief includes the objective, dossier path, owned and protected paths, core data shape, simplicity constraints, checks, and evidence path.

The implementer writes production code and any focused programmatic tests that earn a place. It must:

- follow the approved product path rather than maximize scope;
- reuse or delete before adding parallel mechanisms;
- validate at boundaries and trust internal types;
- avoid one-caller layers and future-provider frameworks;
- run the smallest useful check after each meaningful slice;
- inspect its diff and perform the subtraction pass;
- report behavior, commands, failures, and deliberate omissions.

It cannot mark the package verified or edit the master plan and conclusion.

## Tester decision

Keep verification with the implementer and manager when one cheap deterministic command proves the change. Create `WP-NN C1 test` only when independence adds signal, such as:

- a live Electron or browser path;
- several interacting behaviors;
- security, migration, crash, restart, or recovery behavior;
- failure injection that could contaminate implementation judgment;
- a costly regression whose reproduction deserves a separate artifact.

The tester receives the dossier and working tree. It opens the app and follows the approved flow like a user. It may use a real provider, browser, site, restart, or other external boundary. It never edits production code, automated tests, or fixtures. It records observations and stops after the smallest reproduction of a failure. It does not turn live testing into a programmatic test suite.

## Quality reviewer

After the tester reports, create one read-only `WP-NN C1 review`. Give it the plan, code, and observed results. If testing passed, it rates the implementation for elegance, traceability, and maintainability and asks whether the same outcome has a clearly simpler implementation. If testing failed, it identifies the likely cause and writes focused repair instructions. It does not repair code itself.

Blocking findings require a concrete current cost:

- approved behavior or a named invariant is wrong;
- a real boundary accepts unsafe or ambiguous data;
- state has competing owners or representable contradictions;
- policy or validation is duplicated and can drift now;
- unnecessary layers make the runtime path materially hard to trace;
- the same outcome has a clearly smaller implementation with less indirection.

Formatting preferences, extra hypothetical coverage, speculative extensibility, dependency audits outside the package, non-reproducible performance concerns, and unrelated cleanup are non-blocking. A good implementation does not need a second pass merely to chase a perfect score. The reviewer stays read-only and returns a quality score out of 10 plus `approve`, `approve_with_followups`, or `changes_required`.

## Repair and convergence

For a failed approved behavior or concrete code blocker, use the reviewer's narrow repair brief and create a fresh implementer. Rerun only the affected implementer checks, then repeat the same user-like test. Review again only when the observed result or code changed materially.

Do not start a new cycle for optional cleanup. Do not turn every reviewer suggestion into code. After two attempts hit the same external blocker or expose a new product decision, preserve the evidence and ask the user.

## Closeout

The manager confirms the real artifact, updates the package status, and writes the HTML conclusion. The conclusion explains the user outcome, runtime flow, chosen data shape, code removed or deliberately omitted, proof, concrete limitations, and debugging entry point. Then stop for user review.
