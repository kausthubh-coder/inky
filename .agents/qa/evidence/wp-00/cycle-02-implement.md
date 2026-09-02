# WP-00 cycle 2: implementer report

Role: implementer only. This report does not mark WP-00 verified or complete. The manager still owns independent testing and read-only review.

## Result

Both cycle-1 blockers are repaired in the shared working tree.

- The nine legacy files under `public/` were removed. Their now-empty directories were also removed, so Vite has no legacy public input to copy.
- Invalid self-test profile configuration now prints a specific failure, exits with code 1, and never reaches `app.whenReady()`. A direct audit confirmed that neither the requested nested path nor its parent was created.
- The valid isolated-profile smoke still reaches the renderer marker, reads the narrow runtime bridge, exits 0, and removes its exact temporary profile.
- The fresh TypeScript React and Electron foundation from cycle 1 remains intact. No old shell or product behavior was restored.

## Files changed

Modified production code:

- `electron/main.ts`

Strengthened package tests:

- `tests/clean-room-boundary.test.mjs`
- `tests/build-shape.test.mjs`

Removed legacy production inputs:

- `public/assets/studi-mascot.png`
- `public/demo/assignment.html`
- `public/demo/external.html`
- `public/demo/lms.html`
- `public/demo/moodle.html`
- `public/qa/compare-focus.html`
- `public/qa/compare.html`
- `public/qa/implementation.png`
- `public/qa/reference.png`

Added this report:

- `qa/evidence/wp-00/cycle-02-implement.md`

No package or build configuration changed in cycle 2. The master plan, package dossier, evidence ledger, skill, `AGENTS.md`, package conclusion, and unrelated files were not edited. Git metadata is unavailable in this saved project, so scope was checked against the cycle-1 tester's SHA256 manifest and explicit file inventories.

## Repair details

`electron/main.ts` now validates the self-test profile before setting Electron's `userData` path. The valid branch retains the cycle-1 hardware-acceleration and isolated-profile setup. The invalid branch writes `STUDI_SELF_TEST_CONFIGURATION_FAILED`, calls `app.exit(1)`, returns `false`, and prevents ready-handler registration.

The clean-room test now names all nine discarded public files and accepts a missing `public/` directory. The build-shape test now rejects all nine corresponding `dist/client` outputs, including the QA pages, QA images, and mascot.

## Command evidence

Tested on Windows with Node `v24.19.0`, npm `11.17.0`, Electron `v37.10.3`, and Vite `6.4.2`.

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run typecheck` | 0 | Strict renderer and Electron TypeScript checks passed. |
| `npm run test:electron` inside the managed filesystem boundary | 1 | Environment-only failure. Esbuild could not read above the workspace while loading `vite.config.mjs`. The same command was rerun outside that boundary. |
| `npm run test:electron` outside the managed filesystem boundary | 0 | Build passed. The positive smoke printed a valid marker and runtime versions. Invalid-profile injection printed `invalid-profile=true created=false`. Exact profile cleanup printed `removed=true`. |
| `npm test` outside the managed filesystem boundary | 0 | Typecheck and build passed. All 12 foundation tests passed. This was rerun after the empty `public/` directories were removed, so it covers the final filesystem state. |
| `npm run build` outside the managed filesystem boundary | 0 | Electron compiled, Vite built 32 modules, and the protected Sites preparation step emitted the server and hosting outputs. |
| `npm run test:sites` | 0 | All 4 protected Sites worker tests passed. |
| Direct invalid-profile Electron audit | wrapper 0, Electron 1 | Printed the configuration failure. `invalid_root_created=False` and `invalid_path_created=False`. No cleanup command targeted either path. |
| Final active-input `rg` audit | 1, expected | No LMS names, mock credential, seeded-data marker, old QA name, mascot name, prior workflow module, Pi dependency, or direct Codex launch matched in active source, package, build, worker, script, or hosting inputs. |
| Final `dist/client` `rg` audit | 1, expected | The same legacy patterns produced no match in the built client. |
| Final temporary-profile audit | 0 | `remaining_self_test_dirs=0` and `remaining_invalid_fixture_dirs=0`. |

## Production output audit

The final `dist/client` tree contains 33 files:

- 1 `index.html`
- 1 generated JavaScript bundle
- 1 generated stylesheet
- 30 Nunito Sans and Shantell Sans font files

It contains no `demo/` or `qa/` subtree, mascot, LMS fixture, seeded assignment or course data, mock credential, or prior shell asset. The source `public/` directory no longer exists.

The protected Sites copies also match their sources:

- `dist/server/index.js` matches `worker/index.js`.
- `dist/.openai/hosting.json` matches `.openai/hosting.json`.

## Protected hashes

```text
D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947  .openai/hosting.json
2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389  worker/index.js
B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6  scripts/prepare-sites-build.mjs
96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26  tests/sites-worker.test.mjs
```

All four match the approved dossier values.

## Remaining uncertainty

- This is implementer evidence. A fresh tester must rerun the package gates and failure injection before the manager can decide package status.
- The smoke covers the real Electron boundary without showing an interactive desktop window. Normal interactive window behavior was not retested in this cycle.
- Only Windows was exercised.
- Git diff and status evidence remain unavailable because this saved directory has no usable repository metadata. The cycle-1 manifest comparison shows that the other active source, configuration, protected, and test files kept their prior hashes.

WP-00 is not claimed as verified.
