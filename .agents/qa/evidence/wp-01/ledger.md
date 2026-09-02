# WP-01 evidence ledger

Status: verified, cycle 6

Final working-tree fingerprint: `f641ad09507d072e028cbbd88c26b9dff7c6526c5d639dc0d5d99effd522dca6` (aggregate SHA-256 of WP-01 shared, Electron boundary, and final IPC fixture files; Git metadata was unavailable).

## Package

- Dossier: `.agents/plans/packages/wp-01-contracts.html`
- Objective: define one shared, versioned contract layer for domain records, task transitions, permission resolution, events, tools, and allowlisted IPC.
- Depends on: verified WP-00
- Manager: current Studi build-manager task

## Retained WP-00 follow-ups

- Explicit self-test failure on renderer load errors.
- Development URL permitted only in explicit development mode.
- Shared IPC shape and channel.
- Parent-path non-creation assertion in the default invalid-profile test.

## Cycles

### Cycle 1

- Implementer task: `01a0559b-916b-7471-aaf2-531dfd8b8176` (`WP-01 C1 implement`, `gpt-5.6-sol`, high)
- Tester task: `01a055b0-a9c9-7242-a5b0-248733b9ddb5` (`WP-01 C1 test`, `gpt-5.6-sol`, high)
- Reviewer task: skipped because tests failed
- Verdict: failed — four reproduced contract blockers

### Cycle 2

- Implementer task: `01a055bd-726c-7580-9c75-ca308306dc1c` (`WP-01 C2 implement`, `gpt-5.6-sol`, high)
- Tester task: `01a055ca-4bb8-7510-a0e2-2c2c83d81cd1` (`WP-01 C2 test`, `gpt-5.6-sol`, high)
- Reviewer task: skipped because tests failed
- Verdict: failed — one fragment secret-key bypass remained

### Cycle 3

- Implementer task: `01a055d6-2789-76a1-bcee-2d1ebe743f5c` (`WP-01 C3 implement`, `gpt-5.6-sol`, high)
- Tester task: `01a055dc-183c-7ee3-a94f-bdbedc7b10ba` (`WP-01 C3 test`, `gpt-5.6-sol`, high)
- Reviewer task: `01a055e2-ce9c-7433-bab6-798a6e0010ed` (`WP-01 final review`, `gpt-5.6-sol`, high)
- Review report: `.agents/qa/evidence/wp-01/cycle-03-review.md`
- Verdict: changes required — request-bearing IPC bridge methods ignore their request

### Cycle 4

- Implementer task: `01a055ea-3701-7341-9294-02683617f749` (`WP-01 C4 implement`, `gpt-5.6-sol`, high)
- Tester task: `01a055f2-d4b6-7a03-b835-219eef8d5fbb` (`WP-01 C4 test`, `gpt-5.6-sol`, high)
- Reviewer task: `01a055fa-2c75-7c62-a0f0-847e285e24b0` (`WP-01 C4 final review`, `gpt-5.6-sol`, high)
- Review report: `.agents/qa/evidence/wp-01/cycle-04-review.md`
- Verdict: changes required — caller type uses parsed schema output instead of schema input

### Cycle 5

- Implementer task: `01a0560c-7c3f-73d3-9389-03d48618d73b` (`WP-01 C5 implement`, `gpt-5.6-sol`, high)
- Tester task: `01a05612-126c-7d81-8345-35ab2b28658d` (`WP-01 C5 test`, `gpt-5.6-sol`, high)
- Reviewer task: `01a05617-217f-7431-9b74-bdae016f351d` (`WP-01 C5 final review`, `gpt-5.6-sol`, high)
- Review report: `.agents/qa/evidence/wp-01/cycle-05-review.md`
- Verdict: changes required — transforming schemas were parsed twice across preload and main

### Cycle 6

- Implementer task: `01a0561b-7a15-7703-bfc6-ffd599817aef` (`WP-01 C6 implement`, `gpt-5.6-sol`, high)
- Tester task: `01a05623-c475-7c41-8ae3-2ffc2c1629a2` (`WP-01 C6 test`, `gpt-5.6-sol`, high)
- Reviewer task: `01a05628-a375-72a0-bc87-f6495d2ef943` (`WP-01 C6 final review`, `gpt-5.6-sol`, high)
- Implementer report: `.agents/qa/evidence/wp-01/cycle-06-implement.md`
- Tester report: `.agents/qa/evidence/wp-01/cycle-06-test.md`
- Final review: `.agents/qa/evidence/wp-01/final-review.md`
- Verdict: verified — independent tests green and final review returned `approve_with_followups` with no blocker

## Final manager gate

- `npm test`: the managed-filesystem run stopped at esbuild ancestor-directory access; the identical approved unrestricted run exited 0 with 48 contract and 12 foundation tests passing.
- `npm run test:sites`: exit 0, 4/4.
- `npm run test:electron`: exit 0; valid runtime and manifest crossed the real bridge, invalid profile and renderer load were contained, malformed manifest/runtime results rejected, and the owned temporary profile was removed.
- Protected source hashes remained byte-identical to WP-00.
- No top-level `plans/` or `qa/` directory exists.

## Accepted follow-ups

- Course-bound pattern provenance is owned by WP-02/WP-06.
- Evidence summary and opaque-reference redaction is enforced when capture/export is introduced.
- Preload bundle size and production source-map policy are owned by WP-13.

Conclusion: `.agents/qa/conclusions/wp-01.html`

Code walkthrough: `.agents/qa/conclusions/wp-01-code-walkthrough.html`
