# WP-00 cycle 1: independent tester report

Role: tester only. This report does not mark WP-00 verified or complete.

Verdict: **fail**.

Tested at `2026-08-30T21:39:45.3918920-04:00` on Windows with Node `v24.19.0`, npm `11.17.0`, Electron `v37.10.3`, and Vite `6.4.2`.

## Result

The fresh TypeScript renderer and Electron shell compile, build, and reach the app-ready marker. The positive Electron smoke used a unique system-temp `userData` directory, printed valid runtime versions, removed that exact directory, and exited 0. The browser preview rendered the honest browser-only state with one app-ready marker and no warning or error console entries. Protected Sites files and behavior remain intact.

WP-00 still fails its clean-room contract. Vite copies four discarded prototype fixtures from `public/demo/` into `dist/client/demo/`. Those active production files include mock Moodle, Canvas, and WebAssign flows, seeded course and assignment data, local-storage login state, a demo email, and the hard-coded password `studidemo`. The combined `npm test` gate now catches this and exits 1.

Failure injection found a second containment fault. When `STUDI_SELF_TEST_USER_DATA` points to an unowned nested path, `electron/main.ts` throws the expected ownership error and does not create the directory, but Electron does not terminate. The tester runner killed it after eight seconds. The normal positive smoke remains green, but the default `npm run test:electron` command exits 1 on the fail-fast assertion.

## Tester-owned files changed

- `tests/clean-room-boundary.test.mjs`
  - Scans Vite's active `public/` input as well as `src/`, `electron/`, and `package.json`.
  - Reports concise file, match, and pattern evidence.
  - Adds synthetic LMS, seeded-data, and direct-Codex detector checks.
- `tests/build-shape.test.mjs`
  - Requires discarded demo fixtures to be absent from `dist/client`.
  - Tightens the preload assertion to one exposed bridge, one method, and `ipcRenderer.invoke` as the only renderer call.
  - Adds an arbitrary-IPC failure fixture.
- `tests/electron-self-test-runner.mjs`
  - Adds invalid-profile rejection and fail-fast injection.
  - Preserves an explicit `--positive-only` path so the valid smoke and exact cleanup can be proven independently.

No fixture file was added. I did not change production code, `package.json`, `package-lock.json`, build configuration, the master plan, dossier, skill, ledger, or any protected Sites file. Production and configuration hashes were identical before and after my test edits. Git metadata was unavailable in this saved project, so I used SHA256 manifests instead of a Git diff.

## Exact command evidence

| Command | Exit | Result |
| --- | ---: | --- |
| `node --check tests/clean-room-boundary.test.mjs; ... build-shape ...; ... electron-self-test-runner ...` | 0 | All three tester-edited files parsed. |
| `npm run typecheck` | 0 | Strict renderer and Electron TypeScript checks passed. |
| `npm test` inside the managed filesystem boundary | 1 | Environmental failure before Vite loaded: esbuild could not read above the workspace boundary. Repeated outside that boundary as required. |
| `npm test` outside the managed filesystem boundary | 1 | Typecheck and build passed; 10/12 foundation cases passed. Clean-room source and output cases failed on `public/demo/` and `dist/client/demo/`. |
| `npm run build` | 0 | Electron compiled; Vite built 32 modules; Sites preparation ran. |
| PowerShell required-output and SHA256 copy check | 0 | `dist/client/index.html`, `dist/electron/main.js`, `dist/electron/preload.cjs`, `dist/server/index.js`, and `dist/.openai/hosting.json` exist. Server worker and hosting copies match their sources. |
| `npm run test:sites` | 0 | 4/4 protected Sites regression cases passed. |
| `node --test tests/protected-files.test.mjs` | 0 | 4/4 protected hashes passed. |
| `node --test tests/build-shape.test.mjs` | 1 | 4/5 passed. All four discarded demo pages exist in `dist/client/demo/`. Secure-window, preload, script, entrypoint, and required-output assertions passed. |
| `node --test tests/clean-room-boundary.test.mjs` | 1 | 2/3 passed. Discarded named modules are absent and injected detectors work; active public files contain ten forbidden matches. |
| Discarded-module `Test-Path` plus focused `rg` scan | 0 | `discarded_modules_present=0`, but `rg` found demo LMS, seeded assignment/course markers, and `studidemo` in four active public files. Exit 0 means matches were found. |
| Focused `rg` scan of `src`, `electron`, `package.json`, and lockfile for Pi, Codex, LMS integrations, seeded data, and arbitrary IPC | 0 | Wrapper printed `forbidden_runtime_integrations=0`. Exit 0 means the no-match assertion passed. |
| `npm run test:electron` | 1 | Production build and positive smoke passed; invalid-profile process failed to terminate within eight seconds. |
| `node tests/electron-self-test-runner.mjs --positive-only` | 0 | Printed `STUDI_SELF_TEST` with `marker:true` and four runtime versions, then `STUDI_SELF_TEST_CLEANUP removed=true`. |
| System-temp profile audit | 0 | `remaining_self_test_dirs=0`; `remaining_invalid_fixture_dirs=0`. |
| `npm run dev -- --host 127.0.0.1 --port 43991 --strictPort` | running, then Ctrl+C | Tester-owned Vite server started. The browser inspection completed, then Ctrl+C stopped it. |
| Port 43991 listener audit | 0 | `tester_preview_listeners=0` after shutdown. |

The first tester attempts on ports 4173 and 4174 exited 1 because both ports were already occupied by pre-existing servers. I did not stop or alter those processes. Port 43991 was isolated to this test and was closed afterward.

## Dossier gates

| Gate | Status | Evidence |
| --- | --- | --- |
| Strict typecheck | Pass | `npm run typecheck` exited 0. |
| Combined `npm test` | **Fail** | Final run exited 1 with two clean-room failures. |
| Production build shape | Pass with clean-room output failure | Required outputs exist and Sites copies match. The same build wrongly emits four discarded demo pages. |
| Protected Sites regression | Pass | 4/4 worker tests passed. |
| Electron positive smoke | Pass | Fresh main loaded the renderer, found the marker, called the runtime bridge, printed versions, and exited 0. |
| Exact temporary-profile cleanup | Pass for valid smoke | Cleanup marker printed; post-run audits found zero matching directories. No normal Electron profile was used. |
| Invalid-profile failure injection | **Fail** | Ownership error appeared and no directory was created, but the process hung until killed at eight seconds. |
| Protected hashes | Pass | All four dossier SHA256 values match. |
| Discarded named modules absent | Pass | All nine listed old files are absent. |
| Discarded modules and behavior absent from active paths | **Fail** | `public/demo/` is a Vite runtime input and is copied into production. |
| Secure BrowserWindow flags | Pass | `nodeIntegration:false`, `contextIsolation:true`, and `sandbox:true` are present in the fresh window configuration. |
| Narrow frozen preload bridge | Pass | One frozen `studi` bridge exposes only `getRuntimeInfo`; only the fixed `studi:runtime-info` invoke path is used. Arbitrary IPC injection assertions pass. |
| App-ready marker | Pass | Electron observed it; the browser found exactly one `data-studi-app-ready="true"` element. |
| Browser preview and console | Pass | Heading and browser-only bridge message rendered. `window.studi` was `undefined`. Warning and error logs were empty. |
| No real school, model, or normal profile involvement | Pass for executed tests | No networked school account, model call, direct Codex path, real credential, or normal Electron profile was used. The active public files contain only mock credentials and seeded fixtures, which still violate clean-room scope. |

## Reproducible blockers

### 1. Discarded demo fixtures ship in production

1. Run `npm run build`.
2. Run `node --test tests/build-shape.test.mjs`.
3. Observe exit 1 and these files in the assertion output:

```text
dist/client/demo/assignment.html
dist/client/demo/external.html
dist/client/demo/lms.html
dist/client/demo/moodle.html
```

The source-side reproduction is `node --test tests/clean-room-boundary.test.mjs`. It identifies the corresponding `public/demo/` files and the specific forbidden matches.

### 2. Invalid self-test profile does not fail fast

1. Run `npm run build`.
2. Run `node tests/electron-self-test-runner.mjs`.
3. The valid smoke prints its marker and cleanup lines.
4. The invalid nested profile produces `Self-test userData must be an owned directory under the system temp folder`, but the Electron child remains alive until the tester kills it after eight seconds.
5. The runner exits 1 with `invalid self-test profile did not fail fast`.

## Protected hashes

```text
d532abb65cf9ae20634b464d954cb4a08a0de9f3cd3cdf7f9c3ec8948826d947  .openai/hosting.json
2dd0615a445143933d88d4271f54f5d63ee951421fcd08c5a7617bb09c564389  worker/index.js
b6a6adaa4fab3234676116dd1c9cb6611275ab9d92dd26f5bf402393e3744bf6  scripts/prepare-sites-build.mjs
96af7b48906c6460c793356d7b6952f7d5026dbf5a502bec0d9297ff04201c26  tests/sites-worker.test.mjs
```

## Tested working-state manifest

This manifest covers every active source, Electron, public runtime input, package or build configuration, protected handoff file, and test file exercised by this report. Generated `dist/` files are excluded because `npm run build` recreates them; their existence and source-copy hashes were checked separately.

```text
f7dbda001b627b3a792fb6929303b517f047f03916f2c55227e81216d38a2008  .npmrc
d532abb65cf9ae20634b464d954cb4a08a0de9f3cd3cdf7f9c3ec8948826d947  .openai/hosting.json
6174fd806067498bc6536c6e412492fe84cbfed98fda703b65f322b342baac44  electron/main.ts
741c78a63a83a61ba0e9697f3393f116d9505aa1972a0bd74d75aa3c0c02ac7b  electron/preload.cts
9706596ebe381b233946afa2c43254a6dcbbbde9a79606be7a71c85577c22858  electron/tsconfig.json
d3cbc49dee26394c76afe15c42659e0b1601ec849eeebd4b15a4ef3fb38d8760  index.html
0c4c02e7874e44a45a7402b3feda37115bbbd6703ea6147e202be8a484d3445f  package-lock.json
4c9a1bf20a547ada5f5ddac176b473bff7a577a3ad7d21a465bd5f60e96b7da3  package.json
0236978ca68fa3a7f92f5b414e1171579eb616d8c840c6de1ed607316f097cf7  public/assets/studi-mascot.png
187e9f4cf4c242644a4c21b57f29217bffbb98f4ab16efd8a3afdc2ca4809df9  public/demo/assignment.html
476461c4e317f0a648a1c0bf3709080b9d4efdbcfa9774c5b13bd1a4e705b081  public/demo/external.html
f04194546ade9a038470e44e315aa8089a783f5d782e6b2f9b1807ef113883e1  public/demo/lms.html
f5d0db737ed8ca97fe659806a6cee5ccd519c38c24856584c27696628ce15dbb  public/demo/moodle.html
7209a3b8a40ff63518a13fb6ebbb7810d87e6d006f11caa65f47db839a08800b  public/qa/compare-focus.html
5eacfb8d2fcd0760c24f185174ee9b811d4f355f6b7fc9b3683b84641ed4c4df  public/qa/compare.html
952943bcb877baf34dd7758ea4a1294f9564164377187bf3ac45489e987cd624  public/qa/implementation.png
1da1a5a62fab9c7a32df5f3b33b12dd50bdf58f349cb7390841eda5df4d5dd96  public/qa/reference.png
b6a6adaa4fab3234676116dd1c9cb6611275ab9d92dd26f5bf402393e3744bf6  scripts/prepare-sites-build.mjs
8c6566de3c1411dfc9f3ef39b2d163d3dd3cb96d63bab5677b77de4c33952e19  src/app/app.css
508efb38812391a95b3127bea57b2294484cd519c6401f987c2574af480fb5ef  src/app/StudiApp.tsx
19cced0ad1fb7bc39bf44bd4e36e03a1015ca6266ebd4687b27e3a295e776e43  src/main.tsx
0880b39dd59414048e84ffd5955785beff84dcf4a7ccc37acc256a3da9186505  src/platform/studi-api.ts
a75f5ff8d011e34a9b0447c9be1b80f5092abd34b46567f2e5ef6109187fa416  src/types/window.d.ts
6169364940665f775e90ee5cf0b562432cce0e30b22169bdb7bb4bb8be8f2c03  tests/build-shape.test.mjs
e73940af704c617b7021e8600360765829c185fb42b352cfa742da3133c58acd  tests/clean-room-boundary.test.mjs
8475a3fe2e104054d8851640235d4db5d8f0c7df7d4b1c77cbd49c6b7d09833b  tests/electron-self-test-runner.mjs
c6a39defe0b7b3d7cf656f13ba9f0fd29acdf7e4736c9e0f94134b3819284d99  tests/protected-files.test.mjs
96af7b48906c6460c793356d7b6952f7d5026dbf5a502bec0d9297ff04201c26  tests/sites-worker.test.mjs
b890cebae6a09453b74da6d4fa2d34d5d03fc29da20a96b40f75ac2ec1eb8d6a  tsconfig.json
90e1ab2056898097e0268710beaf81f26aea7997f04da69e607a58a1465eb2a3  vite.config.mjs
2dd0615a445143933d88d4271f54f5d63ee951421fcd08c5a7617bb09c564389  worker/index.js
```

## Untested coverage

- I did not exercise a normal interactive Electron window. The dossier's self-test boundary was used to avoid the normal browser profile.
- I did not test macOS or Linux behavior.
- I did not test real school accounts, browser sign-ins, model calls, LMS navigation, stored profiles, seeded success, or later-package product flows. WP-00 excludes them.
- I did not assess visual polish beyond DOM visibility and console health. This package only requires an honest foundation screen.
- I could not use Git to prove unrelated-file preservation because this saved directory has no readable repository metadata. The before and after SHA256 comparison proves that tester edits were limited to the three test files and this report.

## Tester verdict

**Fail.** The production build still contains discarded LMS and seeded-data fixtures, so the clean-room pass condition is false and the combined gate exits 1. The invalid-profile injection also hangs until killed. A fresh implementer cycle should remove the active public prototype artifacts and make invalid self-test configuration terminate deterministically, then a new tester should rerun the same assertions.
