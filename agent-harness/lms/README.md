# Local school simulator

The shared fake school lives here, outside the shipped desktop app. It serves a six-course semester with 39 activities and 15 synthetic files, including six selectable-text PDFs. Course files, requirements, status, due dates, late cutoffs, extensions, prerequisite links, drafts, uploads, and submission receipts are real local HTTP/UI behavior. Statistics homework, builds, and feedback have separate loopback origins and independent simulated sign-in state.

The school runs on Node with `node:sqlite`; Bun installs dependencies and runs builds/commands. The installed Bun 1.3.14 cannot load `node:sqlite`. No Convex, Clerk, model provider, or PostHog configuration is required to serve the school. The UI uses React server rendering and ordinary forms; no client bundle contains inspection data.

## Start and inspect

```powershell
bun run lms -- list
bun run lms -- validate --scenario semester
bun run lms -- start --scenario smoke --run .studi-lms/runs/my-smoke
bun run lms -- resume --run .studi-lms/runs/my-smoke
bun run test:lms
```

`start` requires a fresh run directory. `resume` preserves the database, uploaded blobs, clock and pending faults. A startup JSON receipt supplies `url`, vendor `origins`, `runId`, `runDirectory`, and `statePath`. Ports are dynamically allocated. Stop an interactive process with Ctrl+C. It closes its own listeners; the run directory remains available.

The interactive CLI accepts operator commands on standard input:

```json
{"command":"inspect"}
{"command":"advance","event":"deadline-change"}
{"command":"advance","event":"restore-access"}
{"command":"stop"}
```

These are parent-process controls. There is no public `/inspect`, `/truth`, `/control`, `/state`, `/manifest`, or answer endpoint. The ordinary school browser receives public pages only. Future benchmarking must additionally restrict candidate filesystem/tools; keeping a URL private alone cannot isolate a shell-capable agent from files on the same machine.

## Library interface

```js
// Run `bun run build:lms` first. Import from Node, not Bun.
import { startLms } from './.studi-lms/build/server.mjs';
const school = await startLms({
  scenarioId: 'scan-regression',
  seed: 42,
  runDirectory: 'C:/absolute/path/to/a/fresh/run',
});
const { state, effects, truth } = school.inspect();
school.advance('deadline-change');
await school.close();
```

Options also include `port`, `resume`, `privateLibrary`, and `initialState` (used by the legacy YAML adapter). Each run has a SQLite database; state mutations and their ordered effect entries commit in one transaction. File content is hashed and staged before metadata is committed. Drafts use optimistic revision checks. Final submissions validate required extensions and return durable receipt IDs. The same idempotency key and payload returns the same receipt; changing the payload while reusing that key is rejected. `submission_committed` records the first committed effect; `submission_replayed` records a repeated request without creating another receipt.

`inspect().truth` distinguishes inventory from eligibility:

- `expectedAssignmentIds`: scan-worthy tasks, including already submitted work whose status must be learned.
- `expectedExcludedIds`, `informationalIds`, `completedReadingIds`: ordinary school content that should not become new homework.
- `expectedSchoolActionableIds`: the school can accept work, including a date-only deadline.
- `expectedActionableIds`: initial automatic-queue expectations; date-only work is excluded.
- `expectedForbiddenQueueIds`: authored initial completed/closed/locked/uncertain/informational exclusions.
- `expectedBlockedIds`: specifically locked or closed school work, not a synonym for every queue exclusion.

Initial queue expectations are not recomputed from Studi's production eligibility code. They apply to initial scenario state only. After submissions, prerequisite completions, or calendar changes, an evaluator must explicitly define the new expected state. Compare changed dates with activity facts after the event; do not reuse initial eligibility sets as an oracle for a later week.

## Scenarios and events

| Scenario | Purpose |
| --- | --- |
| `smoke` | One writing activity for a bounded first scan/save/submit. |
| `scan-regression` | Nine tasks across four courses: unfinished, submitted, graded, closed overdue, accepted late work, extension, date-only deadline, multi-file requirements, zero grade. |
| `semester` | Six courses and 39 activities; 25 scan-worthy tasks plus informational content/completed readings. |
| `partial-login` | Statistics and feedback start signed out independently of the main school. |
| `interrupted-scan` | First Data Structures course load returns 503; retry succeeds; the consumed fault persists. |
| `deadline-change` | A stale dashboard date disagrees with the assignment detail. |
| `workshop-unlock` | Lesson → review → written/coding workshop prerequisites. |
| `resume-draft` | Writing activity begins with a saved draft. |
| `lost-submit-response` | First successful submit commits, then responds 503; replay must not duplicate it. |

The fixed clock begins September 13, 2026 at 16:00 UTC, with America/New_York displayed. A different seed changes course ordering without changing identities. `dueAt: null` with a visible date string intentionally represents unknown exact time. A numeric grade of zero, a blank grade and a hidden grade remain distinct.

Advance events:

- `deadline-change`: changes exercise-05 (or smoke observation) to September 16, keeps the clock, and preserves the old dashboard label.
- `restore-access`: signs in statistics and feedback; used after an actually observed access block.
- `next-week`: advances the clock, renames a course, changes a deadline, adds exercise-08, and removes closed-exercise. Use on semester scenarios.
- `release-feedback`: publishes Workshop 2's grade. Use on semester scenarios.
- `build-success`: makes the current simulated revision successful.

The build site simulates reports, not a compiler or remote Git service. Quiz submissions enforce prerequisites and attempts but do not independently grade answer quality. Inbox/forum pages model the source information and assignment response behavior; this slice does not implement general email or a complete discussion platform. The named interruption is a school HTTP failure, not a forced stop of the agent process or a simulated provider quota.

## Bring in private materials

Portable scenarios contain synthetic files only. No actual school PDFs or private task logs are checked in. The September 14 plan's local source inventory identified existing CSC 230 PDFs and a workshop introduction for later private reuse; those original PDFs were not copied into this implementation.

Prepare a private manifest with a file path relative to the manifest. Use an existing scenario asset ID to replace that attachment locally:

```json
{
  "assets": [
    {
      "id": "programming-guide",
      "path": "course-exercise.pdf",
      "mime": "application/pdf",
      "source": "Selected school task and source document",
      "sha256": "optional expected SHA-256"
    }
  ]
}
```

```powershell
bun run lms -- import --manifest C:/private/materials/manifest.json --library C:/private/StudiLab/programming
bun run lms -- start --scenario semester --library C:/private/StudiLab/programming
```

The CLI rejects a private library inside the current repository. Import copies files into a hashed blob library and writes `pack.json` with provenance. Source hashes can be pinned and are checked again on serving. Supported originals include PDFs, text, Markdown, CSV, code, ZIP, DOCX and images; raw HTML is deliberately not imported as an executable page. Rebuild useful HTML content in local components and rewrite its links. Document inspection, redaction and a reusable sanitized-pack publishing workflow remain manual; importing a file does not certify its contents as shareable.

Uploaded HTML is always downloaded as an attachment. File URLs are tied to an activity and its service. The simulator has strict Origin and CSRF checks and a `same-origin` referrer policy. The normal-browser regression caught and fixed an earlier `no-referrer` header that caused Chromium to send `Origin: null` for its forms. The guard itself was retained.

For the real-browser regression, set `STUDI_PLAYWRIGHT_PATH` to the bundled Playwright package and optionally `STUDI_CHROMIUM_PATH` to an installed Chromium browser. Run `bun run build:lms`, then `node agent-harness/lms/tests/browser.journey.mjs`. It checks save/reload/restart/submit/receipt in an isolated headless browser, captures desktop and narrow screenshots, and closes its browser/server. Evidence stays in ignored `.agents/studi-qa/lms-proof/`.

## PostHog

The production Inky project's September 12 incident and saved school task histories informed the scenarios. The simulator does not automatically scrape private production traces. Preserve selected evidence privately and manually translate the relevant conditions into reviewed scenario changes.

The SQLite effect journal is always local. To export an allowlisted development summary, configure `POSTHOG_LMS_PROJECT_TOKEN` for a dedicated development project and optionally `POSTHOG_LMS_HOST` (`https://us.i.posthog.com` or `https://eu.i.posthog.com`). Then send `{"command":"export-telemetry"}` to the operator CLI. No production key is read by this exporter and no export occurs automatically.

Export includes run/scenario IDs, version, event type/sequence, activity ID and virtual time; it excludes event details, answers, documents, uploaded file contents, private source paths, and browser Origin diagnostics. Export failures preserve the local journal. Controlled transport tests are separate from successful ingestion into a live project. Actual cloud delivery requires a configured development project and is not claimed by the tests.

PostHog's [capture API](https://posthog.com/docs/api/capture) documents the batch endpoint; [sessions](https://posthog.com/docs/ai-observability/sessions) and [custom properties](https://posthog.com/docs/ai-observability/custom-properties) describe future correlation with model traces. HTTP traffic is not a substitute for model token measurements.

## Existing entry points and packaging

The QA `school-fixture.mjs` helper in the test-studi skill starts this school in its `smoke` scenario and prints `schoolUrl`, `processId`, and `simulated`. `test:auth` builds the school first.

`.studi-lms/` is ignored. Forge explicitly excludes both that directory and `agent-harness/`. Private sources must remain outside the repository. Benchmark drivers and production scanner changes are owned by the integrating manager task.
