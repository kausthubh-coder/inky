# Focused passes

Inspect this checkout's `package.json`, scripts and test files before choosing commands. The mappings below are starting points, not a mandate to run every suite. Build before suites importing `dist`. Prefer a relevant existing test or small observable regression over a new framework.

## UI and interaction

- Use the project's `ui-skills-root` to select the smallest relevant design guidance (use Bun/bunx). Start the actual UI preview or existing app. When an HTML proposal shows existing UI, follow `existing-ui-mockups`; reuse React components, fonts, CSS, assets and Inky, keep simulated controls outside product UI, and save plans under `.agent/plans`.
- Inspect screenshots yourself at a normal desktop viewport and a narrow supported size; compare before/after at the same viewport. Check text hierarchy, labels, contrast, clipping, focus visibility and reduced motion when affected. A DOM snapshot or passing locator does not establish visual quality.
- Perform the intended task through visible controls. Can someone tell where to start, what Inky is doing, whether it needs them, and what to do next without explanation? Check keyboard activation, focus after opening/closing dialogs, accessible names and browser toggle state where relevant.
- Select the states this feature can actually encounter: empty/first use, loading, success, failed/retry, needs-user, unavailable and busy. Test the likely transition, not every theoretical combination. Verify no-op clicks, double starts, lost drafts, stuck disabled buttons or contradictory messages. Information should be apparent through hierarchy and action placement before adding more prose.
- Use `bun run test:ui` for relevant UI logic; inspect available `tests/ui/*.journey.mjs` before running their actual interfaces. A browser preview proves presentational behavior. Electron IPC, guest visibility, native focus and cancellation require the relevant real desktop feature pass. A cosmetic icon/copy edit does not require live-model homework execution.

## Agent harness, prompts and memory

Separate **orchestration correctness** from **agent effectiveness**:

1. Trace the production route for the requested job: prompt/pack → session and effective model/reasoning → available tools → execution → persisted result. Assert the actual request/session configuration when changing defaults; a settings label is not proof, particularly with cached sessions or saved overrides.
2. Run relevant agent, contract, storage and harness tests. `bun run test:agent`, `bun run test:storage` and `bun run test:harness` cover different boundaries; inspect their cases. Scripted replies test orchestration and recovery, not model quality. Do not claim a live driver exists from an unmerged benchmark plan; check the CLI in this checkout.
3. For claims about prompt quality, tool use or successful work, run a bounded real-provider task against resettable local ground truth. Keep model, reasoning, fixture and configuration recorded. Grade actual discovered records, artifact contents and external fixture state independently of the agent's self-report. A fixture adapter that bypasses the production coordinator is not production-path proof.
4. Choose a normal task plus the failure suggested by the change: e.g. unavailable tool, cancellation, login handoff, timeout/retry or interruption. For memory changes check save → later retrieve/use → restart, the relevant preference/forget behavior, and separation between synthetic accounts or tasks where applicable. Never probe real users' notes to prove isolation.
5. For comparisons, hold fixtures/configuration constant except the intended variable, retain per-run outcomes/failures, and record elapsed time/tool calls/tokens when available. Missing usage is unknown, not zero. Repeat enough runs to identify unstable behavior when making an improvement claim; do not infer a general quality gain from one successful run or demand a large benchmark for a deterministic bug fix.

If credentials or service availability block a live run, finish controlled proof and report the live gate as pending. Do not silently substitute a mock. Use [full-app-pass.md](full-app-pass.md) when a harness change also alters onboarding or several user journeys.

## Storage, runtime and native systems

Use synthetic or dedicated QA data. For a user-data reproduction, obtain a safe read-only snapshot only within the authorized diagnostic scope; never reuse it as an authenticated QA profile or mutate the original.

| Area | High-value invariant / app check |
| --- | --- |
| Course/assignment identity | Repeated list/detail/alias scans update one record; distinct school IDs remain distinct; references, answers and permissions survive reconciliation and restart. |
| Permission/rules | The selected scope and action persist and are enforced at the effect boundary; a conflict never silently widens permission. |
| Browser ownership/cancellation | Correct target owns effects; delayed/failed stop cannot start competing work; common paused/restart state has a recovery action. |
| Memory/account state | Appropriate owner and preference gate reads/writes; corrupted optional data does not silently contaminate another account or masquerade as valid memory. |
| Updates | Check/download/restart failure and recovery, busy gates and draft persistence. Distinguish service tests from installed platform download/restart. |
| Telemetry/integrations | Real event/result reaches its intended test destination once, with expected metadata and without sensitive content; failure is visible/recoverable. Code instrumentation alone is not delivery proof. |

Choose `test:storage`, `test:contracts`, `test:backend`, `test:auth`, `test:telemetry`, `test:packaging` or `test:electron` as relevant. Read Convex generated guidelines before editing backend code. When runtime behavior changes, follow the affected action in the real app rather than testing only internal helpers. Do not add generic defenses or speculative platform support unrelated to the bug.
