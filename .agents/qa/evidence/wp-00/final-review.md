# WP-00 final maintainability review

Reviewer task: `01a0558b-969d-76f1-859e-72c57923a6f8` (`WP-00 final review`)

Verdict: **approve_with_followups**. No blocking findings. The reviewer changed no files and did not repeat the full green test matrix.

## Why it passed

- The active source, package configuration, and built client contain no legacy shell, LMS fixture, seeded school data, direct Codex path, old workflow, or public demo asset.
- Normal startup creates one isolated `BrowserWindow`, denies popup and renderer navigation, and waits for `ready-to-show`.
- The valid self-test uses an owned immediate child of the system temp directory. The invalid path is rejected before `app.setPath` and exits 1.
- The preload exposes one frozen `studi` object with one fixed `getRuntimeInfo()` call. Node integration is disabled; context isolation and sandboxing are enabled.
- Protected hashes and generated Sites copies match, and the Sites regression suite passes.
- The module layout is small and clear enough for WP-01 to replace the placeholder IPC with shared versioned contracts.

## Non-blocking follow-ups

1. Handle rejected renderer loads and `did-fail-load` explicitly instead of relying on the outer self-test timeout.
2. Allow `VITE_DEV_SERVER_URL` only in an explicit development mode before privileged IPC methods are added.
3. Share clean-room detector helpers so mutation cases exercise the same production-boundary assertions.
4. Add the invalid profile's parent-directory non-creation check to the default automated runner.
5. Centralize the duplicated runtime-info shape and channel in WP-01.
6. Add a visible normal-window smoke when it can be isolated without touching a real profile.

These items do not invalidate WP-00. Items 1, 2, 4, and 5 belong in the WP-01 dossier; item 3 is test maintenance; item 6 is a later desktop-runtime gate.
