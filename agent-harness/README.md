# Studi agent harness

The harness runs Studi's agent job host without Electron. It is the fast place to test routing, durable job state, tool attachment, trace data, bounded homework files, and a loopback-only fake school.

It does not currently run the real Pi model or control the production school browser. The scripted driver makes deterministic replies so contract failures are cheap to reproduce. Electron and visible-browser behavior still go through the `test-studi` journey.

## Run the built-in checks

```powershell
bun run test:harness
```

Run one suite and keep its JSON result:

```powershell
bun run agent:harness -- run --suite foundation --fixture assignment-basic --driver scripted --json
```

Each run writes `.studi-harness/runs/<run-id>/run.json`. The record contains the Git commit, duration, final job state, ordered trace events, usage reported by the driver, and every assertion.

## Customize the fake school

Copy `fixtures/school/assignment-basic.yaml` to another safe name such as `five-courses.yaml`. Change the invented school, course, assignment, and due-date values. Assignment IDs must reference a course ID from the same file.

```yaml
school:
  label: My fixture school
  entryUrl: http://127.0.0.1:43119/
courses:
  - id: math-1
    title: Calculus
assignments:
  - id: limits-1
    courseId: math-1
    title: Limits practice
    dueAt: 2026-09-10T21:00:00.000Z
```

Then run it:

```powershell
bun run agent:harness -- run --suite foundation --fixture five-courses --driver scripted --json
```

Fixture names may contain letters, numbers, and hyphens. The harness only reads fixtures below `agent-harness/fixtures/school`.

## Drive it from another process

Start the line-based session:

```powershell
bun run agent:harness -- interact --fixture assignment-basic --driver scripted --jsonl
```

The first output line contains the temporary `schoolUrl`. After that, write one JSON command per line and read one JSON reply per line.

```json
{"command":"send","target":{"kind":"home"},"text":"What should I do next?"}
{"command":"send","target":{"kind":"assignment","assignmentId":"assignment-1"},"text":"When is this due?"}
{"command":"start_assignment","assignmentId":"assignment-1"}
{"command":"inspect"}
{"command":"abort"}
{"command":"restart"}
{"command":"quit"}
```

Use `send` to test conversation routing. Use `start_assignment` or `start_scan` to test browser ownership and capability attachment. `restart` reconstructs the host from the JSON state file, which is how restart and resume behavior is tested without Electron.

## Add a suite

Add a `*-suite.ts` module that creates an `AgentJobHost`, executes commands, and writes a `HarnessRunRecord`. Register its name in `cli.ts` and `package.json`. Keep assertions about durable state and tool boundaries in the harness. Put window layout, Clerk, real Pi login, and school-pane checks in `test-studi`.

The next driver should implement the existing `AgentDriver` interface and run Pi through stdio. Once that exists, the same fixture and run record can compare the scripted control, plain Pi, and the Electron app with the same inputs.
