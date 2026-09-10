# Integrated verification — 2026-09-10

Mode: focused UI/storage checks plus real Electron authentication, scan, assignment draft, browser recovery, and restart. Base 8a30d80; final UI corrections are committed with this receipt. No merge/release.

## Final checks

- `bun run typecheck` and `bun run build` passed with NODE_OPTIONS=--max-old-space-size=1024. Existing dependency annotation/bundle warnings remain.
- `node --experimental-strip-types --test tests/ui/scan-browser-owner.test.mjs tests/ui/stop-assignment-for-scan.test.mjs`: 8/8 passed, including long-turn gating, delayed abort ordering, failed takeover, changed ownership, and lease release.
- Rendered ScanStatus checks passed: unrelated mutations do not claim scanning/cancellation; actual replay/cancel labels remain; assignment/manager turns permit interruption and cancellation blocks duplicates.
- Earlier integrated 23/23 ownership, reconciliation, and permission checks passed on 8a30d80. Backend/runtime code did not change afterward.
- Full `node tests/electron-self-test-runner.mjs` passed on 8a30d80: onboarding-welcome, onboarding-ready, partial-dashboard, desk-handoff, invalid-profile/renderer-load rejection, malformed manifest/runtime rejection, and cleanup. Earlier readiness timeout did not recur; its cause remains unidentified.

## Real Electron journey

One persistent dedicated QA profile, local fixture only, manual cadence, permission attempt (never submit). Isolated Clerk email-code login/consent used a fresh dedicated identity with an accepted linked invitation. Initial waitlist status recovered to approved after one Check again. No manual entitlement/credit/admin writes. Imported Codex credentials yielded ready provider; real turns used existing GPT-6 Astra/medium selection.

Only the native folder chooser used the documented one-shot simulation to select an empty QA directory. Assignments were discovered, not seeded.

- First scan completed in about 44 seconds: Writing 101, Observation paragraph, September 12, 11:59 PM, exact instructions, complete inventories, no failures.
- Real general chat produced a short reply. An earlier short message landed during onboarding's automatic assignment start and interfered with final outcome recording, reaching needs-user after the draft was already saved. This is recovery evidence, not a clean uninterrupted first work turn.
- Retried assignment: Pause & take over, then I'm done/check, reached ready_review. Fixture health proved answerSaved=true and submitted=false.
- Inspected actual studi-answer.md: exactly 3 sentences describing a rainy afternoon, including rain tapping as the sound and a yellow umbrella as the color. Actual local file existed, 315 bytes. No submission occurred.
- Busy card named the correct assignment; Open assignment opened it. School-browser controls toggled aria-expanded true/false. Saved answer opened in-app.
- Stop-and-scan from needs-user released the lease and completed a replay without duplicate courses/assignments.
- Same-profile restart retained approved auth, ready provider, course course-55087477c691186aa063407f and assignment assignment-2134fe1ab7da1ef20b1d9d27, successful scan, conversation history, and local answer. Review conservatively recovered to needs_user with an explanation that the browser page was not retained and the local answer was preserved.

## Native-discovered fixes

1. Generic pending actions claimed Starting scan/Stopping work. Labels now use action kind.
2. Settings showed stale onboarding rules. Entering Settings refreshes real rules. A controlled public-API rule change outside Settings appeared upon reentry; the temporary rule was removed through UI. Actual global onboarding rule remains visible.
3. Long worker requests disabled Stop assignment & scan throughout the turn. Assignment/manager turns now remain interruptible. An action sequence prevents older aborted completion clearing newer cancellation state, and a ref serializes stop-and-scan.

Final native working-cancellation proof, buildTreeSha256:
`a8e0ad99b5ae73ab36f8d0bc1a095600f7047eccf3a2276961a1b1c7b38fd4cf`

Resumed real worker and verified phase working with enabled stop button. DOM observer recorded enabled Stop assignment & scan → disabled Stopping work… → disabled Scan for homework → disabled Starting scan… → View scan. Finishing aborted request never reenabled cancellation/scan during this transition. Task became stopped (failed lifecycle phase), lease=null, and one replay began. Replay succeeded with no failures and one course/assignment; only dueText wording changed. Saved draft remained unsubmitted.

## Controlled preview coverage

Actual React preview passed all 4 rule scopes/exact payloads/saved state; submission-mode reset and group validation; 1000-character feedback retention on failure, disabled pending input, clearing after confirmed success. No external feedback sent. Conflict kinds/direct rules routing passed. Needs-user scan/browser keyboard toggle/continue passed. No horizontal overflow at 720×520; 1280×850 and narrow images inspected.

## Evidence and limits

Tracked native screenshots: native-busy.png, native-working-stop.png, native-scanning.png, native-rules.png, native-ready-review.png. They show only dedicated QA/local fixture content. Existing integrated-*.png are controlled previews.

Full native log: ignored .agents/studi-qa/pr30-native.log. Launch/build receipts, preserved profile, and answer remain in ignored QA storage. Owned app, relay, and fixture were stopped after testing; profile is preserved.

This covers one local fixture, not broad LMS compatibility, installed auto-updates, or real homework submission. Full controlled startup suite ran on 8a30d80; rebuilt native app exercised final rules, labels, working cancellation, and browser controls afterward.
