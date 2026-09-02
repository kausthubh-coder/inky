# WP-06 evidence ledger

## Outcome

WP-06 is verified. Electron owns one durable manager coordinator, SQLite owns queue order and the singleton browser-worker lease, and Pi owns one persistent manager session plus explicit worker sessions.

## Proof

- Implementer report: `cycle-01-implement.md`
- User-like tester report: `cycle-01-test.md`
- Read-only quality review: `cycle-01-review.md`
- Live receipt: `C:\Users\kaust\AppData\Local\Temp\codex-clipboard-66f9f92b-f8bb-42c6-9a78-2b89c09dbfee.png`
- Real provider: signed-in `openai-codex`, GPT-5.6 Terra, real Pi manager turn completed.
- Live result: the manager inspected SQLite through its Studi tool and truthfully reported an empty queue.
- Restart: the app reopened with the same `0 queued`, no-lease state and provider readiness.
- Coordinator checks: 2/2 for ordering, manual steering, permission refresh, one lease, session recovery, and interrupted acquisition.
- Agent checks: 10/10, including a real Pi `AgentSession` invoking a manager steering tool.
- Storage: 29/29. Contracts: 48/48. Foundation: 12/12. Sites: 4/4.
- Typecheck, production build, and packaged Electron self-test exited 0.
- Protected Sites files remained byte-identical.

## Review

Quality score: 9/10, `approve_with_followups`. No blocker and no smaller design that preserves the current durability and safety requirements.

Retained follow-up for WP-07: if discovery calls `enqueue({ taskId })` for an entry already manually steered, preserve its existing priority unless the caller explicitly supplies a new priority.

## Working-tree note

This workspace has no Git metadata, so a Git commit or diff fingerprint is unavailable. The reports list changed files and the foundation gate checks the protected handoff files directly.
