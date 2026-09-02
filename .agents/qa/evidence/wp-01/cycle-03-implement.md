# WP-01 cycle 3 implementation report

Role: implementer  
Date: 2026-08-30  
Execution speed: normal/default  
Package status: the cycle-2 fragment blocker is repaired and the requested local gates are green. WP-01 is not verified. Independent testing and read-only review remain with the manager.

## Behavior repaired

`fragmentParameterKeys` now scans every query-like segment separated by `?` inside the fragment. It no longer discards a sensitive key/value pair that appears before a later question mark. It also continues to inspect sensitive keys after a question mark, including route-style fragments.

The exact normalized denylist is unchanged. Credential-free routes and unrelated parameter names still parse, including route text containing `authorization` or `token` and unrelated keys such as `authorizationCodeFlow`.

## Smallest reproduction

Before editing, the direct compiled-contract probe exited 0 and showed the blocker:

```text
true  https://school.example/a#token=secret?view=1
true  https://school.example/a#access-token=secret?view=1
true  https://school.example/a#client_secret=secret?view=1
true  https://school.example/a#ACCESS_TOKEN=secret?view=1
false https://school.example/a#view=1?token=secret
true  https://school.example/a#/route?view=1
true  https://school.example/a#authorizationCodeFlow=public?view=1
```

After the repair and rebuild, the same probe exited 0 with the safe result:

```text
false https://school.example/a#token=secret?view=1
false https://school.example/a#access-token=secret?view=1
false https://school.example/a#client_secret=secret?view=1
false https://school.example/a#ACCESS_TOKEN=secret?view=1
false https://school.example/a#view=1?token=secret
true  https://school.example/a#/route?view=1
true  https://school.example/a#authorizationCodeFlow=public?view=1
```

## Production file changed

- `shared/ids.ts`

The parser changed from selecting only the suffix after the first `?` to scanning every fragment segment that contains an equals sign. No permission, event, IPC, transition, development URL, or Electron production code changed.

## Test file changed

- `tests/contracts/schema.test.mjs`

The table now checks sensitive keys both before and after a later `?`. A direct regression table covers `token`, `access-token`, `ACCESS_TOKEN`, `client_secret`, and the reverse ordering. The seeded generated test now crosses query, direct fragment, fragment-before-question, and fragment-after-question positions for case and separator variants. The unrelated-key property covers those same positions, and route controls prove credential-free route text remains accepted.

This report is the only cycle-3 change under `.agents/qa/`. Required builds regenerated `dist/client/**`, `dist/electron/**`, `dist/shared/**`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Commands and exits

| Command | Exit | Result |
|---|---:|---|
| Direct pre-fix compiled-contract probe | 0 | Reproduced four accepted sensitive fragment prefixes before a later `?`; the reverse ordering already rejected. |
| `npm run build:electron` in the restricted sandbox | 1 | TypeScript completed, then esbuild hit the known parent-directory access denial and could not resolve the preload entry from that restricted context. |
| `npm run build:electron` outside the restricted sandbox | 0 | Rebuilt the shared contracts and preload bundle. |
| Direct post-fix compiled-contract probe | 0 | All five sensitive layouts rejected; the route and unrelated-key controls passed. |
| `node --test tests/contracts/schema.test.mjs` | 0 | 17 focused schema tests passed. |
| `npm run test:contracts` | 0 | 42 contract, table, property, IPC, transition, permission, event, and development URL tests passed. |
| `npm run typecheck` | 0 | Renderer/shared and Electron TypeScript configurations passed. |
| `npm test` | 0 | Typecheck and production build passed, followed by 42 contract tests and 12 foundation, protected-file, build-shape, and clean-room tests. |
| `npm run test:sites` | 0 | 4 Sites worker and packaging tests passed. |
| `npm run test:electron` | 0 | Production build and the real Electron boundary passed valid IPC, invalid profile containment, renderer-load failure, malformed manifest, malformed runtime, and cleanup checks. |
| Final protected hash and output scan | 0 | Protected hashes matched cycle 2, all six required outputs existed, and no top-level `plans/` or `qa/` directory existed. |

## Failed attempts

The first post-edit `npm run build:electron` attempt failed only because the restricted Windows sandbox denied esbuild access to a parent directory. I reran the same command with the required outside-sandbox approval, and it exited 0. No implementation approach or test assertion failed, and I did not weaken any check.

Git metadata is unavailable because the saved project is not a Git repository. I constrained the edit with `apply_patch`, the exact owned-file list above, focused source inspection, protected hashes, clean-room tests, and the final hashes below.

## Final hashes and outputs

Changed source and test SHA-256 values:

```text
shared/ids.ts                   855EE5B9E7408F055F155C53CB0636EA511B692F7C3D4ED67D03B6EED2810172
tests/contracts/schema.test.mjs 193DF472877B1950F94BDFD604BAE74EBC6FA8761BDE5610C4A842CDF2C2CCF7
```

Protected SHA-256 values:

```text
.openai/hosting.json            D532ABB65CF9AE20634B464D954CB4A08A0DE9F3CD3CDF7F9C3EC8948826D947
worker/index.js                 2DD0615A445143933D88D4271F54F5D63EE951421FCD08C5A7617BB09C564389
scripts/prepare-sites-build.mjs B6A6ADAA4FAB3234676116DD1C9CB6611275AB9D92DD26F5BF402393E3744BF6
tests/sites-worker.test.mjs     96AF7B48906C6460C793356D7B6952F7D5026DBF5A502BEC0D9297FF04201C26
```

Required outputs present after the final gate:

```text
dist/client/index.html
dist/server/index.js
dist/.openai/hosting.json
dist/electron/main.js
dist/electron/preload.cjs
dist/shared/index.js
```

## Remaining uncertainty and intentionally excluded work

- Secret-key matching remains an exact normalized denylist. Vendor-specific credential names outside that list can pass until the contract adds them.
- Fragment parsing treats each literal `?` as a possible parameter boundary. That fails closed for nested URL-like values containing a denied key, which may reject a credential-bearing nested destination even when the outer fragment uses it as a value.
- This cycle did not change or retest an installed packaged binary. The pure packaged development URL contract and Electron source wiring remain covered by the existing green tests.
- Independent cycle-3 testing and the final read-only maintainability review have not run. This implementer report does not claim WP-01 verification.
