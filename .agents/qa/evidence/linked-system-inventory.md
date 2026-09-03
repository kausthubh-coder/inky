# Linked-system inventory evidence

- Working tree: `cursor/linked-system-inventory-f8ff`
- Typecheck: `tsc -p tsconfig.json --noEmit` and `tsc -p electron/tsconfig.json --noEmit` — exit 0
- Focused gate: Node 22.22.2 `node --test tests/storage/school-scan-coordinator.test.mjs` — 2/2, exit 0
- Agent suite: `npm run test:agent` — 15/15, exit 0
- Full `npm run test:storage` also ran the coordinator checks green. Five unrelated backup-interrupt tests failed by capturing Node’s `node:sqlite` ExperimentalWarning on stderr; they are outside this package
- Live school retry: not available here. No `.studi-qa/profile` and no signed-in Jenkins/Moodle session
