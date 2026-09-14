# Scanner readiness — September 14, 2026

The scanner and harness integrate shipped v0.1.9. No new release is authorized until the founder approves the reviewed candidate.

## What changed

- School submission status, deadline precision, late windows, requirement excerpts and unresolved questions are saved separately from Inky's execution state. Queue and start checks block submitted, graded, locked, stale or incomplete work.
- Scans discover inventories first, batch records, then inspect needed details. Durable source checkpoints and bounded session rotation preserve progress. A scoped **Check assignment details** action refreshes one assignment without starting homework or changing schoolwork; locked work can be rechecked.
- `scan_read_material` reuses the authenticated downloader and PDF reader. PDF/text excerpts carry assignment-bound receipts, source URL, file digest and page provenance. Text is the first reading mode; images cover scans and diagrams. Files stay in the assignment folder. Unsupported or inaccessible material remains a gap.
- Review fixes prevent borrowing another assignment's deadline and prevent a shallow status refresh from reviving stale instructions. A parent-page recheck cannot refresh document evidence.
- Assignment pages display saved requirement excerpts and unresolved gaps. Active school-check messages use the existing Markdown renderer. A durable onboarding timestamp prevents a failed details check from sending an established student back through setup.

## Bounded evidence

One matched pair used the actual v0.1.9 build versus scanner revision `801553e`, the same locked dependencies, smoke fixture/seed 42, Astra/medium, 180 seconds and 90 tools. Later changes cover presentation and onboarding persistence; their focused and app checks are recorded below. There was no benchmark tuning loop.

| Measurement | v0.1.9 scanner | New scanner |
| --- | ---: | ---: |
| Controlled checks | 51/72 | 72/72 |
| Incorrect queue entries | 7 | 0 |
| Live scan | Partial | Complete |
| Live elapsed | 90.4 s | 139.7 s |
| Tools / provider requests | 29 / 30 | 49 / 50 |
| Input / output tokens | 38,342 / 1,580 | 61,734 / 2,951 |
| Cached input tokens | 262,528 | 569,344 |
| Exact deadline and both attachment sources retained | No | Yes |
| Schoolwork writes | 0 | 0 |

This shows a completeness improvement on this smoke case, **not a speed or token-efficiency gain or broad LMS compatibility**. The live grade checks declared inventory, deadline/date-only text, authored on-page requirements and forbidden queue/write effects. Native tests and raw records separately verify attachment provenance. The controlled replay checks nine varied tasks and exact eligibility, without a model.

The independent Codex task performed one browser-only observation: 68.744 seconds, 24 browser API calls plus one documentation call. It found the assignment/deadline/status but could not read the PDF or text rubric. It made no schoolwork writes. It had prior fixture knowledge and different tools, so it is an **informed exploratory observation**, never a blind or directly comparable model trial. Tokens are unknown.

The harness runs the production coordinator, browser, Pi sessions, storage and manager against isolated persistent local schools. Fixture truth stays outside model tools. Comparison gates reject mismatched fixtures/configuration/harness versions, include failed phases, and keep unknown usage unknown. This update adds real session-backed material downloads and fixes the built-in Chromium PDF viewer being miscounted as external navigation.

[Measured records](scanner-readiness-2026-09-14.json). Raw runs remain in ignored `.studi-harness/benchmarks/`: replay `c4f5bef8-8ee6-4f8c-b50b-ce66ddb1d9d8` / `3747dbbd-1065-487c-8ed3-ef23e49f4437`; live `7bc39b92-7b83-4826-9eb9-f7f93e39ce2e` / `4359f9e0-b7ae-489d-98b8-f141b1b6478b`. Older failed comparisons are preserved in the original report.

## Markdown PRs

PR #32 was incorporated through PR #34 and shipped in v0.1.9. PR #33 overlaps that renderer but also exposed hidden active-scan chat messages; the useful visibility change is integrated without adding a second renderer or link policy. Both older PRs remain open; do not merge either wholesale over the integrated work.

## Verification and limits

Typecheck and production build passed. The integrated contract/agent/storage sweep passed 217/218 initially; its sole failure was an old expectation that partial scans restart rather than resume. The corrected contract passed. UI logic: 20 passed. Benchmark graders: 23 passed. Native Electron verifies authenticated redirects, PDF text and image-only pages, text attachments, assignment isolation, provenance, stale refs, login rejection and cancellation. The native PDF viewer capture still times out; the new material reader succeeds without it.

The app's reused dedicated QA identity retained approved access and a ready provider. The first scoped recovery attempt hit provider `fetch failed` errors; this exposed the onboarding-routing regression fixed above. One bounded retry succeeded: the same assignment retained its exact deadline, both document sources, complete requirements and no gaps, without starting work. The actual assignment screen displayed the saved requirements, and a live chat reply used those instructions. Restart retained one assignment, completed onboarding, evidence, chat and an unsent draft.

A separate explicit Start assignment action then produced a three-sentence answer and stopped for review under attempt-only permission. Read-only inspection of the fake school's SQLite state confirmed one saved draft and zero submissions. Restart preserved the answer locally in `studi-answer.md`, explained the lost browser page, and offered Resume/Stop. Stop released the work successfully. This is an integrated journey on a reused admitted profile, not a new fresh-admission pass.

Controlled preview journeys passed for scan handoff, Markdown on desktop/narrow layouts, assignment start/pause/resume/stop, competing activity, files and failure recovery. Two stale journey expectations were corrected: sign-in now opens the browser before Continue scan, and current requirement excerpts take precedence over legacy instructions. Screenshots of the actual requirements page, packaged dashboard and narrow Markdown report were visually inspected.

[Candidate workflow 34872754605](https://github.com/kausthubh-coder/inky/actions/runs/34872754605) passed on Windows and macOS at production revision `29f3c73e17b0368dd282160dcb0c6ca87ad3e8d3`: tests, authenticated native materials, platform packaging and packaged PDF reading. macOS also verified both native renderer architectures. Publishing was skipped. The Windows app extracted from the candidate package opened with the dedicated QA profile, retained approved access and the complete scan, and displayed the dashboard. This did not install over the everyday app or test an updater transition. Windows installer SHA-256: `24cabdea938fdb10ea7a791fde744689960de02332e9dbbee73d213f9b8b0ac1`. Subsequent changes only update journey assertions and this review record.

[Draft PR #35](https://github.com/kausthubh-coder/inky/pull/35) is ready for review. The source app build tree exercised was `9cb8295475315452f4f6453633a8b435afbe0d7e3d97a0a200d0df028fd3c2a2`. Ignored evidence includes `.agents/studi-qa/scanner-ready-verification.json`, `scoped-recovery-result.json`, `scanner-restart-final.json`, `scanner-fixture-outcome.json`, `scanner-work-restart.txt`, `packaged-smoke.json` and `scanner-preview/receipt.json`.

Material limits: a single live smoke pair is not broad school coverage; evidence may be up to 24 hours old; source checkpoint calls drive session rotation rather than a universal production token ceiling. The fake school is a test environment, not a dependency shipped inside Studi. Fresh admission, real-school compatibility, optional integrations, macOS GUI and an installed upgrade need their own evidence before expanding the cohort.

## Next priorities

1. Review this candidate and approve the next release scope. Fresh admission and installed-upgrade gates remain explicit; this is not a claim that every launch gate is verified.
2. Prove one real supported LMS journey: correct submitted/graded exclusion, complete materials, saved work and restart.
3. Verify invited first-session admission and installed Windows/Mac upgrade behavior before moving from five to ten testers.
4. Use actual activation failures and usage measurements to choose later work. Billing/production domain readiness precedes a paid public launch; wider LMS coverage and scan efficiency follow observed needs. Defer broad memory/design rewrites and an open-ended optimization loop.
