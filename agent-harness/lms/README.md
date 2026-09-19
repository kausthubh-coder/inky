# Local school simulator

The shared fake school lives here, outside the shipped desktop app. It serves a six-course semester with 39 activities, course syllabi, weighted exam topics, and synthetic files including selectable-text PDFs. Unused attachments are removed from small scenarios. Course files, requirements, status, due dates, late cutoffs, extensions, prerequisite links, drafts, uploads, and submission receipts are real local HTTP/UI behavior. Statistics homework, builds, and feedback have separate loopback origins and independent simulated sign-in state.

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
| `coding-multifile` | One C project with downloadable source/header files and CSV data; requires exactly one nonempty `main.c`, `stats.c`, `stats.h`, and `README.md`. |
| `quiz` | One three-question stack/queue/complexity quiz, saved drafts, two final attempts, and an operator-only answer grader. |
| `learn` | Two courses, one assignment, one syllabus PDF/page and one exam with three weighted topics. Writing intentionally has no syllabus or exam. |
| `needs-student-file` | One C/data upload requiring the student's original `field-measurements.csv`; missing upload rejects submission and retains the draft. No school download supplies that file. |
| `double-timeout` | One writing assignment; first two submit requests return HTTP 504 after saving the draft, with no final receipt. Reload and retry after that succeeds. |
| `today-edge-cases` | Three writing activities: truly undated reflection, announcement-only undated essay with rubric/word limit, and a late essay with an explicit penalty. |
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
- `exam-moved`: sets `structures-midterm` to September 24, 2026 at 1 PM Eastern; updates its syllabus PDF/page and `/exams`. Optional `examId` selects another existing exam. Repeating the event keeps the same replacement date.
- `expire-session`: signs out `school` by default; optional `service` selects a vendor. Old forms become invalid; normal public sign-in and a fresh form are required.
- `student-edit`: replaces the draft answer while retaining uploaded files and incrementing its revision. Defaults to `observation`; accepts `activityId` and `answer`. Stale saves/submits receive 409.
- `double-timeout`: arms two further submit-service failures. It does not count model attempts or simulate a provider timeout.
- `advance-minutes`: moves the school clock forward by an integer from 1 to 525600 minutes, without sleeping or submitting anything. The driver must advance the app's injected clock separately to exercise scheduled/review actions.

Library controls accept `school.advance(event, options)` and return `{ clock, revision }`. CLI equivalents:

```json
{"command":"advance","event":"expire-session","service":"school"}
{"command":"advance","event":"student-edit","activityId":"observation","answer":"Keep my green awning observation."}
{"command":"advance","event":"exam-moved","examId":"structures-midterm"}
{"command":"advance-minutes","minutes":30}
```

The syllabus page is `/courses/:courseId/syllabus`; the file link is `/files/:courseId-syllabus`. `/exams` lists current exam dates and weights. Exam files/pages are source material, never assignment submission forms. An announcement-only activity remains directly addressable at `/assignments/announcement-response`, but its link is absent from the dashboard, course activity list, and calendar until discovered through Announcements. True work kinds match Studi's public enum: `quiz`, `problem_set`, `essay`, `code`, `discussion`, `reading`, `group_work`.

The build site simulates reports, not a compiler or remote Git service. School submissions enforce prerequisites and attempts. The separate operator grader can grade the dedicated `quiz` scenario; other quiz-like activities remain ungraded. Inbox/forum pages model the source information and assignment response behavior; this slice does not implement general email or a complete discussion platform. The named interruption is a school HTTP failure, not a forced stop of the agent process or a simulated provider quota.

## Focused homework evaluation

Use `coding-multifile` or `quiz` to test one assignment cheaply without scanning a semester. These scenarios use the same durable forms/uploads/receipts as the larger school. The quiz uses a multiline answer form with explicit question labels; it does not simulate a vendor's multiple-choice widget or timer.

```powershell
bun run lms -- start --scenario coding-multifile --run .studi-lms/runs/coding-check
bun run lms -- start --scenario quiz --run .studi-lms/runs/quiz-check
bun run verify --scope lms
```

An operator can import `gradeWork` from `agent-harness/lms/grade-work.mjs` and call `gradeWork(school.inspect(), 'structures-quiz')` or `gradeWork(school.inspect(), 'rainfall-project')` after the production assignment agent works through the public browser. The grader uses committed submissions and the ordered effects journal, not the agent's success claim. It checks draft-before-submit and grades all three quiz answers. It is never imported into the public server/UI.

With `STUDI_PLAYWRIGHT_PATH` and `STUDI_CHROMIUM_PATH` configured as below, `node agent-harness/lms/tests/work.journey.mjs` exercises both new scenarios in a real isolated browser: upload, save, reload, submit, independently inspect receipts, and check narrow layout. It uses synthetic answers/files and is controlled browser proof, not live Inky homework proof.

The default coding grader verifies delivery and explicitly returns `incomplete` until source is independently compiled and functionally tested. It does not execute arbitrary candidate code on the host. `gradeCodingArtifacts(inspection, runDirectory)` from `grade-code.mjs` additionally verifies the actual committed blob lengths/SHA-256, ordinary-file boundaries, UTF-8, and README compile/run/test documentation. These are delivery and documentation checks: even invalid C with a complete README remains `incomplete`, never passed. `rainfallSandboxSpec` defines strict multi-file compilation, exact entry output, and normal, negative, empty, singleton, mixed, fractional and zero-array cases. The optional Docker adapter below can establish functional evidence; default evaluation stays blocked without it. A simulated successful build badge is not code-quality evidence.

Neither homework grader is automatically invoked by the existing **scan-only** live benchmark. A full homework benchmark must invoke production assignment execution, preserve its artifacts, and call the evaluator afterward.

### Optional isolated rainfall compiler (operator only)

`gradeCodingWithDocker(inspection, runDirectory, {image, synthetic: true})` in
`grade-code-docker.mjs` is an opt-in Linux Docker adapter. It requires the
`coding-multifile` scenario, explicit synthetic-only consent, and an operator-reviewed
official GCC image pinned as `gcc@sha256:<digest>` or
`docker.io/library/gcc@sha256:<digest>`. It never pulls an image automatically,
installs a compiler or runs submitted source/binaries on the host. Personal school
code is outside this adapter's authorized scope. Keep operator inputs, Docker
access and receipts unavailable to the candidate.

On a disposable Ubuntu CI runner, after reviewing/pulling the compiler digest
and supplying only synthetic LMS inspection, observation, expectation and blobs:

```sh
# Operator chooses the real immutable digest; this document supplies no fake pin.
docker pull "gcc@sha256:$REVIEWED_GCC_DIGEST"
node agent-harness/lms/evaluate-run.mjs \
  --inspection .studi-lms/proof/after.json \
  --observation .studi-lms/proof/observed.json \
  --expected .studi-lms/proof/expected.json \
  --coding-run .studi-lms/runs/coding-check \
  --docker-image "gcc@sha256:$REVIEWED_GCC_DIGEST" --synthetic \
  --output .studi-lms/evaluations/rainfall-docker.json
```

Expectation remains `{"kind":"homework","activityId":"rainfall-project"}`.
The CLI combines independent Docker quality with the existing measured-budget,
policy and completed-attempt gates; a candidate's success narrative cannot set
the grade. Default `--coding-run` still performs static checks only. Exit 1 means
failed/incomplete evidence; inspect `codingArtifacts.compiler` and `functional`.

The adapter rechecks the four committed files, limiting each to 64 KiB and their
sum to 128 KiB. It copies freshly written, hashed ordinary files, a fixed driver
and synthetic CSV using `docker cp` into a **never-started staging container**.
It commits that bounded source layer, then executes only fresh read-only containers.
This avoids trying to copy into a read-only execution root or a tmpfs; Docker
documents [copy behavior and tmpfs limitations](https://docs.docker.com/reference/cli/docker/container/cp/)
and [container commits](https://docs.docker.com/reference/cli/docker/container/commit/).
The staging root is writable solely for input copying; submitted code never runs there.

Each execution uses these fixed Docker options:

```text
--pull=never --network=none --read-only --cap-drop=ALL
--security-opt=no-new-privileges:true --user=65534:65534
--pids-limit=32 --memory=128m --memory-swap=128m --cpus=1 --ipc=none
--ulimit core=0:0 --ulimit fsize=4194304:4194304 --restart=no
--log-driver=none --no-healthcheck
--tmpfs /work:rw,exec,nosuid,nodev,size=33554432,mode=1777
--env TMPDIR=/work --env HOME=/work --env LC_ALL=C
--workdir=/work --entrypoint=/bin/sh
```

No host mounts, Docker socket, credentials, added capabilities, devices or published
ports are passed. The adapter inspects the effective container configuration before
starting it. Compilation and execution share a 10-second limit per case; the
evaluation has a 120-second work budget, with bounded cleanup afterward. Captured
output is limited to 64 KiB. It force-removes only its UUID-named containers and
disposable source image, including after a timeout; cleanup failure blocks a pass.
The reviewed base image remains installed.

One case compiles `main.c` plus `stats.c` with C11, all warnings and `-Werror`, and
checks exact `5.00\n` entry output. Seven independent cases compile the trusted
driver with `stats.c`, never candidate `main.c` or candidate header in the driver.
The driver accepts numeric inputs; expected numeric results remain in the operator.
Each case gets a fresh container, so candidate entry code cannot overwrite a later
oracle executable. Host validation rejects missing/duplicate cases, extra output,
nonfinite/wrong values, nonzero exits, timeouts, output overflow and OOM.

Receipts bind the committed `artifactHash`, `testsHash` (driver/cases/commands/limits),
requested compiler digest, inspected compiler image ID, disposable source image ID,
architecture, and bounded observed outcomes. `expected` and `observations` remain
separate. These are finite functional tests, not a proof of every possible input or
a security boundary against kernel exploits; use only disposable synthetic-code CI.

Local status: Docker/Podman/host C compilers and WSL are unavailable; none were
installed. No real container compilation has run. Focused
`node --test --test-concurrency=1 agent-harness/lms/tests/docker-grader.test.mjs`
tests the planner, identity/result validation and cleanup with **synthetic Docker
transcripts**, not executable C. A real CI run is required before claiming functional
rainfall success. Compiler availability is separate from live ChatGPT/Claude auth.

## Redesign evaluation contracts

Everything below is **operator-only**. Keep inspection, expected results, graders, run databases, and uploads outside the candidate's filesystem/tool access. Give the production driver only public origins, task identity, budgets, and its own workspace. A shell-capable candidate sharing this checkout is not isolated merely because `/truth` returns 404.

`inspect().truth` adds `expectedExams`, `expectedTopics`, `expectedSyllabi`, `expectedKinds`, `expectedStudentFiles`, `expectedUndatedIds`, `expectedAnnouncementOnlyIds`, `expectedRubrics`, and `expectedLatePenalties`. Exam/topic facts reflect the current school revision, including `exam-moved`. Existing queue sets remain **initial-state** expectations; do not use them as a later-week queue oracle. Syllabus PDFs are deliberately mutable persisted source material; resume checks still pin all other attachment hashes and every private override. Private replacement content needs a separately authored expected manifest; synthetic exam truth does not certify private PDFs.

Import independent checks from `evaluate.mjs`:

- `gradeLearn(inspection, observation, origins)`: normalized persisted `exams: [{id,courseId,title,date,sourceUrl}]` and `topics: [{id,examId,courseId,title,chapter,weight}]`. Map production-local IDs to fixture IDs in a trusted adapter using course/source identity. Source URLs must be the matching syllabus page or file on the school origin. Missing, extra, duplicate, stale, or invented records fail. Empty arrays are required to prove a source-free result; missing observations do not pass.
- `gradeRedesignDiscovery(inspection, assignments, origins)`: persisted assignment `sourceTarget`, `kind`, `dueAt`, `instructions`/`requirementEvidence`. Complements the existing scan grader with kind, undated, rubric and late-penalty checks; run both graders for full scan coverage.
- `gradeRecovery(before, after, expectation)`: author `{activityId,newSubmissions,savedAnswer,events}` **before** running the driver. Optional `timeouts`, `notBefore`, and `studentFileHashes: {filename: sha256}` check fault counts, review timing, and original student-file identity. Compares retained history, exact receipt counts, saved text, and a page re-read between a student edit and the next write. It grades school effects, not renderer phase labels or browser ownership.
- `gradeHomeworkDoesNotTeach(beforeLevels, afterLevels)`: compare nonempty persisted `{topicId,level,evidence}` snapshots across actual homework completion. This detects mastery/evidence writes; it cannot prove tutoring quality.

For a missing-file journey, the operator supplies `agent-harness/lms/operator-fixtures/field-measurements.csv` only after observing `needs_user` in Studi. Keep it inaccessible to the candidate until that handoff. Record its hash before import and pass that independent hash to `gradeRecovery`; the school does not invent or auto-provide student data. For A6, use two fresh runs with the same saved answer: expected `newSubmissions: 0` under review-only and `1` under auto-submit, plus the expected `notBefore` timestamp. Advancing the LMS clock alone proves neither app policy nor scheduling.

`benchmark-receipt.mjs` combines recorded observations with independent homework/Learn/recovery evaluation. Observations use:

```json
{
  "evidenceClass": "live-production-runtime",
  "config": {"model":"actual-model","provider":"actual-provider","effort":"actual-effort","budgetMs":120000,"maxToolCalls":40},
  "policyViolations": [],
  "attempts": [{"status":"completed","metrics":{"durationMs":1234,"toolCalls":5,"modelCalls":2,"usage":null,"costUsd":null}}]
}
```

Controlled adapters use `evidenceClass: "controlled"` and null model/provider/effort if no model ran. Preserve failed attempts before the final retry. Record usage from the production provider diagnostics, not HTTP request counts. Missing/invalid token fields or monetary charges remain null, including when a timed-out generation has only a partial usage lower bound. `costUsd: 0` means an explicitly measured zero charge, not an unknown subscription cost. Keep known partial generation usage separately in the observation. This wrapper checks measured time/tool budgets and stores `expected`, `observation`, and `evaluation` separately; an agent's `passed` claim cannot set the grade.

Evaluate recorded JSON after a controlled or live production run:

```powershell
node agent-harness/lms/evaluate-run.mjs --inspection .studi-lms/proof/after.json --observation .studi-lms/proof/observed.json --expected .studi-lms/proof/expected.json
# Recovery also requires --before; Learn also requires --origins.
# Coding can add --coding-run <school-run-directory> for blob/documentation checks.
```

Expected homework input is `{"kind":"homework","activityId":"structures-quiz"}`; Learn uses `{"kind":"learn"}`; recovery uses `{"kind":"recovery",...}` plus the explicit fields above. Output is written once under `.studi-lms/evaluations/` (or `--output`), with exit 1 for failed/incomplete evidence. The CLI evaluates saved evidence and does not launch a model or constitute a live driver.

Focused regressions live in `tests/redesign.test.mjs` and `tests/evaluators.test.mjs` under this LMS directory. They exercise HTTP/state/effect contracts and deliberately wrong observations. Run `bun run test:lms` only while holding the shared heavy-test slot. These controlled tests support A2–A4, A6, A8, L1/L4/L8 and undated/announcement stories at the simulator/evaluator boundary. Full app phases, notifications, takeover ownership, tutor interaction, and live provider execution still need the coordinator's integrated pass.

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

`agent-harness/school-fixture.ts` translates the old YAML fixture through a Node child process running this shared school. The QA `school-fixture.mjs` helper is an async shared-server adapter; its CLI still prints the established `schoolUrl`, `processId`, and `simulated` receipt. Old `/health` answer flags were removed in favor of operator inspection. `agent:harness` and `test:auth` build the shared fixture first.

`.studi-lms/` is ignored. Forge explicitly excludes both that directory and `agent-harness/`. Private sources must remain outside the repository. Benchmark drivers and production scanner changes are owned by the integrating manager task.
