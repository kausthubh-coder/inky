---
name: verified-build-loop
description: Plan and run substantial app work through small product slices, restrained implementation, risk-based verification, and one independent quality review. Use for architecture, migrations, or work packages where code quality and proof both matter.
---

# Verified build loop

Build the smallest coherent version of the approved product. Verification supports judgment. It does not justify extra code, tests, roles, or documents.

## Set the quality bar first

Before planning or coding, read [quality-oracle.md](references/quality-oracle.md). Apply it twice:

1. Before implementation, to choose the data shape, boundaries, and smallest useful slice.
2. After tests pass, to remove code and indirection that did not earn a place.

The target is code a future maintainer can trace quickly. Prefer direct control flow, one source of truth, narrow boundaries, and domain-shaped types. Three clear statements are better than a premature abstraction.

## Ground the work

Read the repository instructions, current plan, relevant code, and closest tests. Later explicit user decisions override earlier ones. Find technical facts from primary sources instead of asking the user. Ask only when a real product choice remains.

For a substantial product effort, keep one master plan with the product boundary, trust boundaries, runtime flows, state ownership, package dependency order, and release criteria. Do not design every future class or helper. The master plan fixes interfaces and ownership only where later packages depend on them.

Use [workflow.md](references/workflow.md) for planning and [artifact-contracts.md](references/artifact-contracts.md) for dossiers and conclusions.

## Plan one package at a time

Each dossier defines one observable outcome and a quality contract:

- the user or maintainer value path;
- the core data shape and state owner;
- existing code to reuse, simplify, or delete;
- the smallest coherent implementation boundary;
- code and behavior explicitly excluded;
- the few current risks worth proving;
- exact pass conditions and the cheapest real check for each.

Do not prescribe a file count, test count, or abstraction count. Do name anything the package must not grow, such as a second state machine, generic provider framework, compatibility layer, or duplicated validator.

## Run a proportionate manager cycle

The calling task is the manager. It owns scope, architecture decisions, role briefs, and completion. Read [manager-thread-cycle.md](references/manager-thread-cycle.md) before creating role tasks.

1. Create one implementer with the approved plan. It deepens the plan only when needed to make the code path clear, writes production code, owns useful programmatic checks, and performs a subtraction pass.
2. Add a tester when the package has a real app, provider, browser, restart, migration, security, or recovery boundary. The tester uses the app like a user and does not write automated tests, fixtures, or production code.
3. Create one read-only reviewer after the tester. If the live test passed, the reviewer rates code quality and looks for a clearly more elegant implementation. If the live test failed, the reviewer diagnoses the failure and writes a focused repair brief.
4. Accept a good implementation. Start another cycle only for a failed approved behavior or a concrete code problem with meaningful current cost. Park theoretical hardening and optional polish.

For Studi, role tasks use `gpt-5.6-sol` with high reasoning at normal speed. Stop after each package conclusion so the user can inspect it before the next package starts.

## Verify what matters

Choose checks from the risk map, not a desire for coverage. The implementer may add a programmatic test when it protects approved behavior, difficult pure logic, or a bug that occurred. The independent tester does not add tests. It proves the real path by opening and using the app.

Use `$verify-studi` for the closest runtime proof available today. Extend that skill only when a real Studi surface exists and the new control or check will be reused.

Do not add permutations, fixtures, failure injection, validators, or recovery paths for states the current package cannot produce. Do not keep a test whose only purpose is to mirror implementation details.

## Finish when the package is sufficient

A package is complete when its approved behavior works through the closest real boundary, its named risks have evidence, the quality reviewer finds no concrete blocker, and the diff passes the quality oracle. More possible testing or more possible abstraction is not unfinished work.

Write a concise HTML conclusion in execution order. Explain what the user gets, how data and control move, why the chosen structure is small, what was deliberately omitted, the proof, and where to start debugging. Do not produce a file-by-file tour or inflate the artifact with snippets.

## Hard stops

- Do not implement before the relevant product boundary is approved.
- Do not let mocks or seeded data masquerade as a real result.
- Do not preserve throwaway compatibility code during an approved clean replacement.
- Do not erase unrelated user work to make a gate pass.
- Do not let a tester or reviewer repair the code it judges.
- After two attempts hit the same external blocker or require a new product decision, preserve the evidence and ask the user.
