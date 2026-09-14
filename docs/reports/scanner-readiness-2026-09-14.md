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

The app's reused dedicated QA identity retained approved access and a ready provider. The first scoped recovery attempt hit provider `fetch failed` errors; this exposed the onboarding-routing regression fixed above. Final app recovery and platform build results are pending below.

Material limits: a single live smoke pair is not broad school coverage; evidence may be up to 24 hours old; source checkpoint calls drive session rotation rather than a universal production token ceiling. The fake school is a test environment, not a dependency shipped inside Studi. Fresh admission, real-school compatibility, optional integrations, macOS GUI and an installed upgrade need their own evidence before expanding the cohort.

## Next priorities

1. Review this candidate and approve the next release only after the remaining readiness checks.
2. Prove one real supported LMS journey: correct submitted/graded exclusion, complete materials, saved work and restart.
3. Verify invited first-session admission and installed Windows/Mac upgrade behavior before moving from five to ten testers.
4. Use actual activation failures and usage measurements to choose later work. Billing/production domain readiness precedes a paid public launch; wider LMS coverage and scan efficiency follow observed needs. Defer broad memory/design rewrites and an open-ended optimization loop.
