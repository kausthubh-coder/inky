# WP-06 cycle 01 quality review

## Verdict

**9/10 — `approve_with_followups`.** The final green implementation is direct, traceable, and appropriately small. I found no concrete current-cost blocker and no clearly smaller implementation that preserves the approved durability, recovery, permission, and real-Pi boundaries.

## Runtime trace and reader load

- Queue state enters through `ManagerCoordinator.enqueue`: a task ID is resolved to the stored task and assignment, permission is derived from repository-owned confirmed pattern matches plus stored rules, the task event stream moves to `queued`, and the canonical queue entry is written to SQLite.
- SQLite is the sole durable owner of ordering, queue entries, the singleton browser-worker lease, confirmed matches, and the manager-session link. `ManagerCoordinator` is the sole production orchestration owner and mutation path; the task event stream separately remains the authoritative task-state history. Repository calls outside the coordinator occur only in validation and tests.
- Permission policy is decided once by `resolvePermission`. The coordinator constructs its pattern context only from `listConfirmedPatterns`; none of the manager tools accepts a pattern ID or rule provenance.
- Single-worker policy is enforced durably by the singleton `browser-worker` primary key and an insert that cannot replace an existing lease. The coordinator checks early for a useful error, while the SQLite insert is the actual atomic arbiter.
- Restart recovery is easy to follow: an `acquiring` lease is released; an `active` lease resumes only when the durable task is still `working`; stale queue rows are removed; and durable queued tasks missing a row are reconstructed or cancelled if refreshed permission denies work. Ordering is always derived from SQLite rather than mirrored in memory.
- The real manager is a Pi `AgentSession` with all built-in tools disabled and exactly three custom tools: inspect, steer, and cancel. Runtime creation verifies that Pi's configured and active tool names exactly match that set. Preferences and explicitly requested memories are loaded into separate prompt sections. The manager has no browser, filesystem, SQL, worker-start, or pattern-provenance tool.

These answers can be obtained from the coordinator, repository, permission resolver, and runtime without reconstructing unrelated parts of the app. The separation between coordinator policy, SQLite mechanics, and Pi session construction changes abstraction level at each boundary and earns its cost.

## Blockers

None.

## Useful follow-up

- Before WP-07 begins replaying discovery into this API, preserve the existing queue entry's priority when `enqueue({ taskId })` is called for an already queued task. The current `input.priority ?? 0` resets a prior manual steer. This is non-blocking for WP-06 because no production caller currently re-enqueues queued work, restart recovery does not use this path, and all approved live behavior passed.

## Unnecessary code and maintainability

No material unnecessary layer, duplicated state owner, unsafe pattern-provenance path, generic job framework, or speculative provider abstraction was found. The canonical JSON plus indexed SQLite columns are deliberate persistence mechanics, and read-time agreement checks prevent those representations from silently drifting. I would not extract the small repository validation helpers merely to reduce local repetition.

## Verification reviewed

- The tester's real `openai-codex` Pi manager turn and app reopen passed.
- `npm run typecheck`: exit 0 during this review.
- `node --test tests/storage/manager-coordinator.test.mjs tests/agent/manager-session.test.mjs`: exit 0; 3 tests passed during this review.

## File discipline

All reviewed production, test, fixture, plan, skill, dossier, and prior-evidence files were untouched. This review report is the only source/evidence file added by the reviewer; the verification commands were read-only with respect to reviewed files.
