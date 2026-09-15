# Agent harness

Two tools for testing Inky without the desktop UI:

- [`lms/`](lms/README.md): the local fake school. Serves realistic courses, assignments, files, drafts and submission receipts on loopback so scans and homework can be tested against known ground truth.
- [`benchmark/`](benchmark/README.md): runs the production scan coordinator, storage and browser controller against that school, either by replaying fixed observations or live with a real provider in a hidden Electron window, and grades the result.

Neither runs during `bun run test`. Use `bun run test:lms` and `bun run test:benchmark` for their own checks.
