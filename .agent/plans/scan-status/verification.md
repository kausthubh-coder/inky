# Integrated verification receipt — 2026-09-10

Mode: focused UI + affected storage/permission/ownership checks. Integration base de309f6, plus course-conflict presentation and fixture improvements in final commit. Production UI uses actual scan/lease state; synthetic data is confined to preview fixtures.

Passed on final source:
- bun run typecheck (NODE_OPTIONS=--max-old-space-size=1024).
- bun run build (same heap). Existing bundle-size warning remains.
- node --experimental-strip-types --test tests/ui/scan-browser-owner.test.mjs tests/ui/stop-assignment-for-scan.test.mjs tests/storage/course-reconciliation.test.mjs tests/storage/assignment-reconciliation.test.mjs tests/contracts/permission.test.mjs — 23/23.
- Actual React preview journey: all four permission scopes sent exact payloads; selected class/assignment and saved rule state shown; scope switch reset submission mode; missing confirmed-group ID disabled saving.
- Feedback: controlled failed submission retained all 1000 characters; pending field disabled; confirmed submission cleared the draft; exact note sent without hidden prefix. No external feedback transmitted.
- Course conflicts: permission-kind notice routes directly to Homework rules; references-kind notice remains visible without that misleading action. Both explicitly state automatic work is paused. Storage regressions assert both kind values.
- Scan: Help Inky opens School check; keyboard Enter opens/closes browser, aria-expanded changes; continue transitions needs-user to running. No horizontal document overflow at 720x520. Screens visually inspected at 1280x850 and 720x520.

Evidence:
- Tracked .agent/plans/scan-status/integrated-rules.png, integrated-conflicts.png, integrated-scanning.png, integrated-narrow.png.
- Reusable tests/ui/homework-rules-feedback.journey.mjs (controlled API transport).
- Ignored .agents/studi-qa/integrated-typecheck.log, integrated-build.log, integrated-focused.log.

Failed / limited:
- node tests/electron-self-test-runner.mjs --positive-only initially timed out at app readiness (25 seconds), before UI assertions. integrated-native.log records it.
- One bounded native launch investigation with desk-handoff reached STUDI_SELF_TEST_READY and CDP renderer within the same 25-second window. Native-launch-probe.json records diagnostics. Its owned process/profile were cleaned up. First launch timeout cause is unidentified; no full-native pass claimed.
- Previous native toggle proof predates this combined tree. Final guest focus/visibility and actual delayed worker cancellation remain unproven on the combined tree.
- No live provider, account creation, fixture scan/draft, or restart journey run. Existing dedicated QA profile is preserved and signed out; account lookup found no dedicated identity. Manager halted provider/account setup at 66% weekly remaining to preserve quota.
- Preview server stopped; no QA/probe app left running by this task. No merge or release.
