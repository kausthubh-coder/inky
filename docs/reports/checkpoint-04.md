# Checkpoint 4 — homework end to end (J2)

Status: **PARTIAL**. The fake-school Electron journeys and live quiz passed. The live coding submission passed delivery and integrity checks, but its C compiler and functional cases were not run because this Windows host has neither Docker nor WSL. The focused assignment-details path uses the new browser observations but still retains legacy detail-recording tools; its full migration remains open.

## Gate

| Criterion | Target | Result | Evidence |
|---|---:|---|---|
| Scripted Electron J1/J2 | 3 consecutive green runs | **Pass:** 6/6, 6/6, 6/6 | `node --test tests/e2e/*.test.mjs`; final run durations 71.9, 73.6, 73.8 s |
| Live fake-school quiz | ≥90% correct, one submission, matching receipt | **Pass:** 3/3 correct, one committed submission, Studi receipt | `tests/live/j2-homework.test.mjs`, GPT-6 Sol/high |
| Live multi-file C assignment | Functional tests pass, one submission and receipt | **Partial:** four committed files, hash/length/README checks pass; one submission and receipt; compiler cases not run | `gradeCodingArtifacts` outcome `incomplete`; no Docker/WSL on host |
| Attempt-only | Zero submissions before student acts | **Pass:** scripted and live coding runs recorded zero; student then submitted once | Fake LMS effect journal, J2 tests |
| Takeover and Stop | Recover without a submission | **Pass:** two scripted journeys | `j2-homework.test.mjs` |
| Real-app captures | Activity C and doubt-first review D | **Pass** | Screenshots below |

## What changed

- Starting an incomplete assignment now runs a focused read-only details check before the worker. Connector and browser discoveries create a task origin so Today can start them. The details path uses observed browser pages and a reduced set of scan tools; replacing its remaining legacy detail-recording API is still required.
- The worker records specific activity labels and review evidence. Doubts lead the review panel, and submission requires either the student's explicit request or the stored auto-submit rule after review. One durable submission attempt is allowed; affirmative post-submit evidence is required for a receipt.
- Added isolated Playwright Electron journeys for onboarding/Today, quiz, coding files, takeover, Stop, and both submission rules. The harness uses a project-local Playwright dependency, disposable profiles and a local fake school. It cannot access the student's real school.
- Updated the native materials and foundation tests for stable browser refs and the scan row tool; updated IPC contract expectations for `finishSchoolScan`.

## Commands and actual output

```text
$ bun run test:e2e
✔ J1: onboarding scans the isolated LMS and Today matches expected.json
✔ J2 files: coding work stays in the homework folder and uploads the required files
✔ J2: attempt-only stops at review, student submits once, and Studi shows the receipt
✔ J2: auto-submit commits exactly once when the review window ends
✔ J2: takeover pauses a working assignment and Stop this releases it
✔ J2: Stop from the composer cancels a working assignment without submitting
ℹ tests 6
ℹ pass 6
ℹ fail 0
ℹ duration_ms 91088.3875
```

After the final screenshot harness adjustment, three consecutive full `node --test tests/e2e/*.test.mjs` runs each reported `tests 6`, `pass 6`, `fail 0`; their final durations were `71867.1645`, `73563.835`, and `73751.1663` ms. A separate screenshot-only rerun passed after retrying Windows desktop capture; that capture retry does not change the product journey.

```text
$ node --test --test-name-pattern='IPC registry snapshot|auto-submit rejects confirmation' tests/contracts/ipc.test.mjs tests/storage/lifecycle-execution.test.mjs
✔ IPC registry snapshot contains the fixed desktop workspace channels
✔ auto-submit rejects confirmation text that was already visible before the effect
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

```text
$ node tests/electron-self-test-runner.mjs
STUDI_EXTERNAL_ELECTRON ... "scenario":"desk-handoff" ... "cleanup":"process-stop-and-profile-finally"
STUDI_SELF_TEST_REJECTION invalid-profile=true parent-created=false
STUDI_SELF_TEST_REJECTION renderer-load=true timed-out=false
STUDI_SELF_TEST_REJECTION malformed-manifest=true
STUDI_SELF_TEST_REJECTION malformed-runtime=true
STUDI_SELF_TEST_CLEANUP removed=true
```

The live quiz and coding tests ran earlier in this checkpoint using the production Pi runtime against the local fake school. Their temporary harness profiles were deleted after the runs. The quiz grade was `passed` (3/3); coding artifact grade was `incomplete`, with committed bytes and README checks passed. No real school was accessed.

## Screenshots

- [Activity C](screenshots/checkpoint-04-activity-native.png): labelled work steps beside the native fake-school assignment page.
- [Review D](screenshots/checkpoint-04-review-native.png): Inky's doubt first, requirements and saved work, student submission instructions, and the native fake-school page.

## Not done, or failed

- The coding functional gate remains **unverified**. `gradeCodingArtifacts` intentionally does not execute submitted code on the host; the isolated Docker adapter requires a pinned image and Docker runtime. The static `incomplete` result is not a functional pass.
- The focused assignment-details check still calls legacy detail recorders (`scan_check_source`, `scan_read_assignment` and related tools) behind a narrower tool list. Its full migration to the Checkpoint 3 recording API is unfinished.
- The first broad `bun run verify --changed` failed on stale IPC, confirmation-text, stable-ref, and self-test timing expectations. Those tests were updated. The final controlled verifier passed every check:

```text
$ bun run verify --changed
passed: typecheck
passed: typecheck-lms
passed: build
passed: build-lms
passed: node-tests (500.3s)
passed: backend
passed: harness-foundation
passed: harness-routing
passed: harness-trace
passed: harness-files
passed: electron
passed: native-materials
passed: native-downloads
passed: .agents\studi-qa\checks\2026-09-24T21-10-48.781Z-16352/result.json
```

The Node log ends with `tests 495`, `pass 495`, `fail 0`. The verifier receipt is local QA evidence and is ignored by Git.
