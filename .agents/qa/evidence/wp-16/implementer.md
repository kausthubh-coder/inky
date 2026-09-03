# WP-16 implementer

- Expanded the existing TelemetryService allowlist instead of adding a second analytics stack.
- Scan and assignment completion events now carry model, reasoning effort, duration, token/cost fields when Pi reports usage, and consented school facts.
- identifyClerk stores Clerk email/name. Secrets (password, cookie, token, sk-, authorization) are still stripped. Arbitrary undeclared properties are still rejected.
- School WebContentsView still has no PostHog injection.
- Settings copy no longer claims events are fully scrubbed.

Commands:

```
npx tsc -p electron/tsconfig.json --noEmit   # 0
npx tsc -p tsconfig.json --noEmit            # 0
npm run test:telemetry                       # 0 (6/6)
npm run test:packaging                       # 0 (1/1)
npm run test:contracts                       # 0 (58/58)
```

`npm run test:agent` failed only on `tests/agent/manager-session.test.mjs` because this environment's Node 22.14 `node:sqlite` has no `backup` export. Unrelated to telemetry.

Deliberately omitted: raw prompt/answer upload, school-browser replay, dashboards, and a sign-in telemetry opt-in.
