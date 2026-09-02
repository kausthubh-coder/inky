# WP-00 cycle 2: independent tester report

Role: tester only. This report does not mark WP-00 verified or complete.

Verdict: **pass**.

Tested at `2026-08-30T21:58:00.4648263-04:00` on Microsoft Windows NT `10.0.26200.0` with Node `v24.19.0`, npm `11.17.0`, Electron `v37.10.3`, and Vite `6.4.2`.

## Result

The exact cycle-2 working state passes every WP-00 tester gate. The two cycle-1 blockers are closed.

- `public/` is absent. Neither active runtime inputs nor `dist/client` contain the discarded prototype's LMS names, old module references, seeded course or assignment content, demo credentials, direct Codex launch, scripted stages, old workflows, QA pages, or mascot.
- The valid Electron self-test reached the single app-ready marker through the narrow runtime bridge, exited 0, and used a unique owned directory directly under the system temp folder. Tester cleanup removed only that directory and preserved a sibling sentinel.
- An invalid unowned nested profile exited 1 in 0.323 seconds. It printed the fixed configuration rejection and created neither the supplied parent nor leaf path.
- `BrowserWindow` keeps `nodeIntegration:false`, `contextIsolation:true`, and `sandbox:true`. Source and compiled output expose one frozen `studi` object with only `getRuntimeInfo()`. Its only renderer IPC operation is `invoke` on the fixed `studi:runtime-info` channel.
- The in-app browser rendered one visible `data-studi-app-ready="true"` marker and the expected foundation heading. `window.studi` was undefined in the browser-only preview. Console warnings and errors were empty.
- All required build outputs exist. The protected worker and hosting copies match their sources byte for byte, and all four protected source hashes match the dossier.

A separate read-only reviewer may now inspect this green shared state. The manager still owns review sequencing and package closeout.

## Tester-owned changes

I added only this report, `qa/evidence/wp-00/cycle-02-test.md`. I did not change production code, tests, fixtures, package or build configuration, plans, the skill, `AGENTS.md`, the evidence ledger, or any protected Sites file. Required build commands regenerated `dist/`.

The saved project has no usable Git metadata, so I used explicit inventories and SHA256 manifests instead of a Git diff.

## Exact command evidence

| Command or check | Exit | Observation |
| --- | ---: | --- |
| `npm run typecheck` | 0 | Strict renderer and Electron TypeScript checks passed. |
| `npm test` inside the managed filesystem boundary | 1 | Environmental failure before Vite loaded. Esbuild could not read above the workspace boundary or resolve `vite.config.mjs`. |
| Authorized `npm test` outside that boundary | 0 | Typecheck and build passed. All 12 foundation cases passed. |
| Authorized `npm run build` outside that boundary | 0 | Electron compiled, Vite built 32 modules, and Sites preparation completed. |
| `npm run test:sites` | 0 | All 4 protected Sites worker cases passed. |
| Authorized `npm run test:electron` outside that boundary | 0 | Build passed. Valid marker and runtime observation, invalid-profile rejection, and exact cleanup all printed. |
| Independent valid and invalid Electron injection wrapper | 0 | Valid child exit 0. Invalid child exit 1 in 0.323 seconds. All cleanup and non-creation assertions passed. |
| Broad legacy `rg` scan of active inputs | 1, expected | No forbidden match. Planning, QA evidence, and test detectors were excluded. |
| Broad legacy `rg` scan of `dist/client` | 1, expected | No forbidden match. |
| Required-output, protected-hash, and Sites-copy audit | 0 | Five required outputs exist. Four protected hashes and two generated copies match. |
| Tester preview server | running, then Ctrl+C | Vite served `http://127.0.0.1:43993/` for the browser check. |
| Port 43993 listener audit after shutdown | 0 | `tester_preview_listeners=0`. |

The managed-boundary `npm test` exit 1 is not a product failure. The same command passed unchanged when the filesystem restriction that blocked esbuild was removed. No assertion ran or failed in the blocked attempt.

## Dossier gates

| Gate | Status | Evidence |
| --- | --- | --- |
| Strict typecheck | Pass | `npm run typecheck` exited 0. |
| Combined foundation gate | Pass | Final `npm test` exited 0 with 12 of 12 cases passing. |
| Production build | Pass | `npm run build` exited 0. |
| Sites regression | Pass | `npm run test:sites` exited 0 with 4 of 4 cases passing. |
| Electron smoke | Pass | `npm run test:electron` exited 0. |
| Valid owned profile | Pass | Marker and all four runtime strings were present. Child exit was 0. |
| Exact valid-profile cleanup | Pass | Only the exact owned profile was removed. A sibling sentinel remained until its separate cleanup. |
| Invalid nested profile | Pass | Child exit was 1 in 0.323 seconds. Parent and leaf stayed absent. |
| Clean-room source boundary | Pass | `public/` and all 18 named discarded files are absent. The active-input scan found no forbidden behavior. |
| Clean production client | Pass | `dist/client` has 33 files: one HTML file, one JavaScript bundle, one stylesheet, and 30 font files. It has no `demo/` or `qa/` subtree. |
| Secure window | Pass | Source and compiled main output contain all three required isolation flags. |
| Narrow preload | Pass | One frozen API, one exposed world object, one fixed method, one fixed channel, and no arbitrary send, listener, or channel parameter. |
| App-ready marker | Pass | Electron and browser checks both observed the marker. The browser counted exactly one visible marker. |
| Browser console | Pass | Warning and error log list was empty. |
| Protected Sites files | Pass | All approved SHA256 values match. |
| Required output shape | Pass | `dist/client/index.html`, `dist/electron/main.js`, `dist/electron/preload.cjs`, `dist/server/index.js`, and `dist/.openai/hosting.json` exist. |
| Forbidden external involvement | Pass | Tests used no school account, model call, networked LMS, normal Electron profile, or real credential. |

## Independent failure injection

The direct audit did not call `tests/electron-self-test-runner.mjs`. It launched the built Electron entrypoint twice with tester-generated environment values.

For the valid run, the profile was an immediate child of the system temp directory named `studi-wp00-self-test-independent-<guid>`. The child printed a successful marker with non-empty app, Electron, Chrome, and Node strings, then exited 0. The profile existed after Electron quit. The tester rechecked that its parent was the system temp directory, removed that exact profile, and confirmed a separately created sibling directory still existed.

For the invalid run, the supplied profile was nested under a nonexistent `studi-wp00-invalid-independent-<guid>` parent. Electron printed `STUDI_SELF_TEST_CONFIGURATION_FAILED` with the ownership message, exited 1 after 0.323 seconds, and created neither path. The tester never issued cleanup against the invalid parent or leaf.

## Clean-room and output audit

The scan covered `src/`, `electron/`, `package.json`, `package-lock.json`, `index.html`, `vite.config.mjs`, both TypeScript configs, `.openai/hosting.json`, `worker/index.js`, and `scripts/prepare-sites-build.mjs`. It separately scanned `dist/client`.

The patterns covered Moodle, Canvas, Blackboard, Brightspace, D2L, Schoology, Cengage, WebAssign, Pearson, Gradescope, McGraw Hill, zyBooks, generic LMS references, all named discarded module paths, the prior BIO 150 seeded fixture, education email credentials, `studidemo`, seeded and demo school data, scripted agent or task stages, direct `codex` spawn or `execFile` calls, `moodle-adapter`, and `school-workflow`. Both scans returned `rg` exit 1, the expected no-match result.

Top-level planning and QA reference images remain outside Vite's active inputs. They were intentionally excluded from the runtime scan and did not ship in `dist/client`.

## Protected hashes

```text
D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947  .openai/hosting.json
2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389  worker/index.js
B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6  scripts/prepare-sites-build.mjs
96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26  tests/sites-worker.test.mjs
```

`dist/server/index.js` matches `worker/index.js`. `dist/.openai/hosting.json` matches `.openai/hosting.json`.

## Tested working-state manifest

Generated `dist/` files are excluded because the required commands recreate them. Their shape and source-copy hashes were checked separately.

```text
f7dbda001b627b3a792fb6929303b517f047f03916f2c55227e81216d38a2008  .npmrc
d532abb65cf9ae20634b464d954cb4a08a0de9f3cd3cdf7f9c3ec8948826d947  .openai/hosting.json
5db88ea6398cb9f6e576414eb524ad0ad7ededad32fc03e9fba83578b34b91ea  electron/main.ts
741c78a63a83a61ba0e9697f3393f116d9505aa1972a0bd74d75aa3c0c02ac7b  electron/preload.cts
9706596ebe381b233946afa2c43254a6dcbbbde9a79606be7a71c85577c22858  electron/tsconfig.json
d3cbc49dee26394c76afe15c42659e0b1601ec849eeebd4b15a4ef3fb38d8760  index.html
0c4c02e7874e44a45a7402b3feda37115bbbd6703ea6147e202be8a484d3445f  package-lock.json
4c9a1bf20a547ada5f5ddac176b473bff7a577a3ad7d21a465bd5f60e96b7da3  package.json
b6a6adaa4fab3234676116dd1c9cb6611275ab9d92dd26f5bf402393e3744bf6  scripts/prepare-sites-build.mjs
8c6566de3c1411dfc9f3ef39b2d163d3dd3cb96d63bab5677b77de4c33952e19  src/app/app.css
508efb38812391a95b3127bea57b2294484cd519c6401f987c2574af480fb5ef  src/app/StudiApp.tsx
19cced0ad1fb7bc39bf44bd4e36e03a1015ca6266ebd4687b27e3a295e776e43  src/main.tsx
0880b39dd59414048e84ffd5955785beff84dcf4a7ccc37acc256a3da9186505  src/platform/studi-api.ts
a75f5ff8d011e34a9b0447c9be1b80f5092abd34b46567f2e5ef6109187fa416  src/types/window.d.ts
6d39f66d51450d64e7c35c32cddd3a58e53efc2508022ea61889f7f556427169  tests/build-shape.test.mjs
ddb6125b374e6f33ab109b1717a049e293aeaf231a5b18e4fe86e464c0fcc595  tests/clean-room-boundary.test.mjs
8475a3fe2e104054d8851640235d4db5d8f0c7df7d4b1c77cbd49c6b7d09833b  tests/electron-self-test-runner.mjs
c6a39defe0b7b3d7cf656f13ba9f0fd29acdf7e4736c9e0f94134b3819284d99  tests/protected-files.test.mjs
96af7b48906c6460c793356d7b6952f7d5026dbf5a502bec0d9297ff04201c26  tests/sites-worker.test.mjs
b890cebae6a09453b74da6d4fa2d34d5d03fc29da20a96b40f75ac2ec1eb8d6a  tsconfig.json
90e1ab2056898097e0268710beaf81f26aea7997f04da69e607316f097cf7  vite.config.mjs
2dd0615a445143933d88d4271f54f5d63ee951421fcd08c5a7617bb09c564389  worker/index.js
```

## Blocker reproductions

None. No tester gate failed in the unrestricted execution environment.

To reproduce the green state, run these commands from the project root:

```text
npm run typecheck
npm test
npm run build
npm run test:sites
npm run test:electron
```

The invalid-profile case also has a smaller built-boundary reproduction. Set `STUDI_SELF_TEST=1`, set `STUDI_SELF_TEST_USER_DATA` to a nested path whose parent is not an immediate owned self-test directory under the system temp folder, and launch Electron with the project root. The expected result is exit 1, the fixed configuration rejection, and no created path.

## Uncovered cases

- I did not launch a normal interactive Electron profile. The package requires isolated temporary state, and using the normal profile would violate the test boundary.
- I did not test macOS or Linux behavior.
- I did not test real school accounts, sign-ins, LMS navigation, model calls, stored browser sessions, or later-package product flows. WP-00 excludes them.
- I checked the browser screen for marker count, visible foundation copy, bridge absence, and console health. I did not grade visual polish because WP-00 does not require a finished product screen.
- Git-based unrelated-change proof remains unavailable because this saved directory has no usable repository metadata. The manifest records the exact active source, configuration, protected, and test state judged here.

## Tester verdict

**Pass.** Cycle 2 closes both prior blockers, every required gate is green, and no blocking reproduction remains. A fresh read-only reviewer may inspect this exact state. WP-00 remains unverified until the manager completes that review and closeout.
