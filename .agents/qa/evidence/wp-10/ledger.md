# WP-10 evidence ledger

## Working copy

This directory has no Git metadata, so the implementer used SHA-256 source fingerprints rather than a commit or diff identifier. The focused source manifest is in `source-manifest.txt`.

Protected source hashes after the package:

- `.openai/hosting.json` `d532abb65cf9ae20634b464d954cb4a08a0de9f3cd3cdf7f9c3ec8948826d947`
- `worker/index.js` `2dd0615a445143933d88d4271f54f5d63ee951421fcd08c5a7617bb09c564389`
- `scripts/prepare-sites-build.mjs` `b6a6adaa4fab3234676116dd1c9cb6611275ab9d92dd26f5bf402393e3744bf6`
- `tests/sites-worker.test.mjs` `96af7b48906c6460c793356d7b6952f7d5026dbf5a502bec0d9297ff04201c26`

## Retained runtime evidence

- `sign-in-gate.png`: current production renderer at the real pre-onboarding gate.
- Live accessibility observation: heading `Finish in your browser`; no school browser region exists before approval.
- Convex deployment accepted the final schema and reported functions ready.
- Unauthenticated cloud probe: account bootstrap rejected, admin mutation rejected.

## Current limitation

The system browser requires the tester to complete Clerk sign-in and consent. Until that happens, the real approved/denied callback, encrypted Windows credential reopen, online restart, offline restart, and cloud device row must remain unclaimed by this implementer.
