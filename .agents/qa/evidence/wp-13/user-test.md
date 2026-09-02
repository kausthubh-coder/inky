# WP-13 repaired packaged-build user test

Date: 2026-09-02 (America/New_York)  
Role: read-only normal-user tester  
Outcome: **FAIL at the first safe live school scan — packaging, approved identity, real Codex readiness, tray reopen, and same-profile restart pass**

## Boundary used

- Artifact: `out\Studi-win32-x64\Studi.exe`, modified `2026-09-02T03:51:38.1428767Z`.
- Launch: unpacked packaged executable from `C:\Windows\Temp`, outside the repository.
- Reused isolated profile: `C:\Users\kaust\AppData\Local\Temp\studi-wp12-live-20260901-150355`.
- Electron CDP: loopback-only `http://127.0.0.1:9222`.
- Automation: Microsoft's official Playwright Electron MCP, accessibility snapshots, semantic interaction, and the public `window.studi` projection. Computer Use was not used.
- Renderer: packaged file URL below `out\Studi-win32-x64\resources\app\dist\client\index.html`.

The previous development Electron process owning this isolated profile was terminated by its exact verified PID before the packaged executable was launched. No personal browser profile, school account, coursework, source file, production test, plan, or skill was changed.

## Observed results

| Journey boundary | Result | Observation |
| --- | --- | --- |
| Launch from outside repository | PASS | The packaged executable remained running, exposed CDP only on `127.0.0.1`, loaded the packaged renderer, and presented the first-run onboarding UI. |
| Runtime/version projection | PASS | `app=0.1.0`, Electron `37.10.3`, Chromium `138.0.7204.251`, Node `22.21.1`. |
| Clerk identity and Convex entitlement restore | PASS | Dedicated identity `studi.wp12+clerk_test@example.com` restored as `approved`, beta plan, 100 credits, and `secureStorage=true`. The public subject matched the prior approved fixture. |
| Telemetry privacy state | PASS | Clerk-linked identity projection restored while analytics and replay both remained disabled; the inspector was empty. |
| Local onboarding/state honesty | PASS | No school profile, scan, courses, assignments, linked systems, queue entries, lease, task, or artifact was invented. The persistent embedded school browser remained at `about:blank`. |
| Product settings restore | PASS | Review 15 minutes, handoff 30 minutes, `memoryVisibility=selected`, no permission rules, and no scan schedule. |
| Provider status | PASS / ACTION NEEDED | The app truthfully reported `OpenAI Codex needs authentication` with GPT-5.6 Terra selected. |
| Fresh device authorization | PASS | Activating **Connect Codex** produced an HTTPS destination at `auth.openai.com/codex/device`, no query string, a non-empty one-time code, an expiry, and no projected error. The code value is intentionally omitted. |
| Provider ready and one real manager turn | Initially blocked | A permitted human had to complete the displayed OpenAI device authorization. The continuation below records the completed handoff and live agent result. |
| School/LMS scan through restart/tray coverage | Initially not run | The initial run stopped at the required auth handoff. The continuation below records the safe downstream coverage. |

## Completed user action

The user completed the device authorization in a permitted human-controlled browser without sharing the code. On the next single poll, Studi reported OpenAI Codex `ready`, GPT-5.6 Terra selected, and no remaining provider-login material.

## Authorization continuation and live safe flow

| Boundary | Result | Observation |
| --- | --- | --- |
| Real provider readiness | PASS | The packaged app reported OpenAI Codex `ready` after the human device handoff; no login attempt or one-time material remained. |
| Onboarding/profile | PASS | Saved `Studi QA`, `https://example.com`, and **Only when I ask** through the visible onboarding form. Password entry remained confined to the embedded browser; no password was needed. |
| Persistent browser navigation | PASS | **Open my school** opened the embedded `WebContentsView` at Example Domain. Playwright semantically observed the expected read-only Example Domain content. The agent later navigated visibly to IANA's Example Domains help page. |
| One real Codex agent turn | PASS at runtime / FAIL at product result | **Scan my school** ran the real connected provider against the safe read-only page. The turn completed, but the agent did not call its required finish tool. |
| Evidence-backed scan truth | PASS | Studi stored the first scan as `failed`, showed the exact failure, retained empty coverage, zero courses, zero assignments, zero linked systems, and no workflow revision. It did not seed demo data or route to a populated dashboard. |
| Recovery surface | PASS | The onboarding UI remained visible with **Scan again** and a `failed` Browser evidence card. The tester did not retry blindly. |
| Close to tray | PASS | Alt+F4 hid the main window while the packaged root, its browser children, and loopback CDP remained alive. |
| Reopen | PASS | Launching the packaged executable again caused the original app to return `windowVisible=true`; provider readiness and failed-scan evidence were unchanged. A non-owning secondary root lingered without CDP and was terminated by its exact PID after the original window reopened. |
| Same-profile restart | PASS with limit | After exact-process termination and relaunch from `C:\Windows\Temp`, approved Clerk/beta/100 credits/secure storage, Codex readiness, GPT-5.6 Terra, profile, manual schedule, default attempt permission, telemetry opt-out, and the failed scan all restored. The embedded browser reopened at `about:blank`; this run had no authenticated school session with which to prove cookie retention. |
| Renderer diagnostics | PASS | After restart the packaged renderer reported zero console errors and zero warnings. |
| Dashboard/library/desk, queue/takeover/resume/cancel/review/fallback | BLOCKED | A failed first scan with no verified coverage correctly keeps the app in onboarding. Exercising these surfaces would require seeding or bypassing success. |
| Settings diagnostics export and offline launch | NOT RUN | Settings was unreachable behind the truthful first-scan gate. Networking was deliberately left unchanged, so the restart does not claim offline coverage. |

## Smallest failure reproduction

1. Launch the repaired packaged executable from outside the repository with the approved isolated profile.
2. Complete real OpenAI Codex device authorization and observe provider `ready`.
3. Save onboarding with `Studi QA`, `https://example.com`, and manual scanning.
4. Open the read-only Example Domain page in Studi's embedded browser.
5. Activate **I’m signed in — scan my school**.
6. Wait for the real agent turn to end.
7. Actual: the durable scan is `failed` with `The school scan ended without the finish tool and remains incomplete.`, empty coverage, zero observed entities, and no workflow revision.
8. Expected: the agent explicitly finishes with an evidence-backed zero-result/partial result so the UI can distinguish a completed safe scan from an unclosed agent session while still remaining incomplete.

## Evidence hygiene

- No screenshot was retained because the only new visible state contained a one-time device code.
- No authorization URL query values, one-time code, OAuth state, authorization code, token, cookie, secret environment value, school URL/content, prompt, answer, or browser command line was written to this report.
- The device authorization completed outside automation; no one-time or token material was inspected or retained.
- No screenshot was added because the semantic state and public projections fully establish the failure without creating another artifact.

## 2026-09-02 corrected packaged-build live replay attempt

Role: same read-only normal-user tester  
Runtime: corrected unpacked packaged app, isolated WP-12 profile, root PID `2904`, loopback CDP `127.0.0.1:9222`  
Outcome: **BLOCKED before a new scan — the dashboard exposes replay for a retained partial first scan that has no workflow revision**

### Restored trusted boundaries

| Boundary | Result | Observation |
| --- | --- | --- |
| Clerk + Convex | PASS | Dedicated test identity restored `approved`, beta plan, 100 credits, and `secureStorage=true`. |
| Real provider | PASS | OpenAI Codex restored `ready` with GPT-5.6 Terra selected. |
| Local profile and policy | PASS | Canonical root is `https://moodle-courses2527.wolfware.ncsu.edu/my/`; cadence remains manual; the only global permission remains `attempt` (attempt, never submit). |
| Packaged runtime | PASS | Studi `0.1.0`, Electron `37.10.3`, Chromium `138.0.7204.251`, Node `22.21.1`. |
| Embedded browser target | INCONCLUSIVE | The browser reopened at `about:blank`. The retained partition was not navigated, so this process did not re-prove the authenticated Moodle cookie through visible evidence. |

### Retained current-snapshot projection

Before the attempted replay, the corrected build honestly restored the prior partial first-scan record:

- state `partial`, current step `School scan preserved partial results`;
- one unique retained course sourced from the observed Moodle enrollment page;
- zero assignments, zero linked systems, zero task origins, zero queue rows, zero artifacts, zero manager entries, and no active lease;
- two verified coverage targets (`Moodle Courses 2025-2027 sign-in` and `My courses`) plus one partial catalog target;
- failure: only page 1 was inspected and the observed LSC 170 course was not self-enrollable, so assignments were inaccessible;
- `workflowRevision=null`;
- course, assignment, and task ID sets contain no duplicates. With zero eligible assignments, the one-origin/one-queue-row invariant is vacuously preserved but not positively exercised.

The visible dashboard matched that projection: `partial school view`, zero verified assignments, empty five-day deadlines, empty queued/working/review/done columns, and a disabled **Start next assignment** control. The manager command bar was visible with no manager entries. Library visibly reported `No task history yet`, no artifacts, and no selected detail.

### Blocking user-flow reproduction

1. Launch the corrected packaged build on the retained isolated profile.
2. Observe approved auth, real Codex readiness, canonical Moodle root, manual schedule, safe `attempt` permission, and the retained partial first scan with `workflowRevision=null`.
3. In the visible **This week** dashboard, activate **Scan again**.
4. Actual: the UI reports `Error invoking remote method 'studi:replay-school-scan': Error: A successful school scan is required before replay`.
5. The embedded browser remains `about:blank`; no new scan row starts and the retained partial projection is unchanged.

Expected: the visible recovery action for a partial first scan either starts a new first scan against the saved canonical root or resumes/retries that incomplete scan. It must not route to replay when replay requires a successful workflow revision.

The tester did not activate the duplicate **Retry visible scan** control after the concrete replay failure, did not call navigation or scan IPC directly, and did not seed/reset scan state. Therefore authenticated Moodle persistence, a current repaired scan, workflow creation, assignment/task/queue mapping, linked-system handoffs, and a safest no-submit candidate remain unverified in this run. No coursework, enrollment, grade, credential, production code, or automated test was changed.

## 2026-09-02 partial-scan retry repair live test

Role: same read-only normal-user tester  
Runtime: repaired unpacked packaged app, preserved isolated profile, root PID `13048`, loopback CDP `127.0.0.1:9222`  
Outcome: **PASS for fresh-start routing and truthful handoff; STOP at required Moodle sign-in**

### Preconditions

- Dedicated Clerk identity remained approved with beta plan, 100 credits, and secure storage.
- Real OpenAI Codex remained `ready` with GPT-5.6 Terra.
- The saved school root remained exactly `https://moodle-courses2527.wolfware.ncsu.edu/my/`.
- Manual cadence and the global `attempt` / never-auto-submit permission remained unchanged.
- The retained prior state was still one partial first scan, one unique historical course, zero assignments, zero linked systems, zero tasks, zero artifacts, zero manager entries, and `workflowRevision=null`.

### Repaired visible action

From the visible dashboard, **Scan again** no longer produced the prior replay error. It created a new scan with a new ID, `kind=first_scan`, and navigated Studi's embedded browser from `about:blank` into the saved Moodle root. This proves the partial/null-workflow recovery action now chooses a fresh start.

The current browser snapshot then showed Moodle's public login surface:

- page title `Log in to the site | Courses 2025-2027`;
- canonical Moodle login page URL;
- `You are not logged in`;
- an NC State Unity Login link for students/faculty/staff;
- a separate Brickyard Login option for guests/affiliates/parents.

No authenticated dashboard or course content was visible, so no credential, Unity link, login control, or scan continuation was activated.

### Truthful terminal handoff

The real Pi/OpenAI Codex scan reached the actual terminal user-handoff state:

- scan state `needs_user`;
- kind `first_scan`;
- current step: `Moodle Courses 2025-2027 requires an NC State Unity ID or Brickyard login; no authenticated session is visible.`;
- handoff kind `school_sign_in` with the same reason;
- one browser-grounded agent observation sourced from Moodle's login page;
- empty coverage and empty failure lists;
- `workflowRevision=null`;
- zero new assignments, linked systems, task origins, queue rows, artifacts, manager entries, or assignment execution.

The one historical course retained from the earlier partial scan remains local while this new scan waits, but the new scan did not claim it as current coverage. Because no eligible assignment was discovered, assignment-to-origin-to-queue uniqueness and the safest no-submit candidate cannot yet be exercised. No duplicate task or queue row was created.

### Exact human action

The embedded school browser is left visibly on Moodle's login page. The student must choose **Unity ID Login**, complete NC State Shibboleth and Duo directly in Studi's browser, and return. After sign-in, the live test may resume the `needs_user` scan through the visible app. The tester must not enter or inspect those credentials.

No coursework was submitted, no enrollment or grade was changed, no credential was entered, and no source or automated test was edited.
