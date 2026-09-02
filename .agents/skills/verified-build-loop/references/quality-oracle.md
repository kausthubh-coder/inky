# Quality oracle

Use this before the implementer brief and once more on the final green diff. Its job is to improve the design, not to invent work.

## Start with the outcome

Name what the end user can do after this package and what the next maintainer needs to understand. If a proposed module, option, or test changes neither, it probably does not belong.

Tighten the product's main loop before adding secondary capability. Prefer fewer finished behaviors over many partial ones.

## Name the data shape

Choose the structure before the logic:

- one state machine instead of related booleans;
- one typed model instead of repeated shape assumptions;
- one registry or table instead of branches spread across files;
- one owner for mutable state;
- validation where untrusted data enters, then trusted typed data inside.

Do not force a pattern when direct local code is already clear. A structure earns its place by removing invalid states, duplicated decisions, branches, or coordination.

## Spend less code

Before adding code, look for code the change makes obsolete. Delete dead paths and redundant checks first.

Every abstraction must pay rent now. A wrapper with one caller, an adapter with no second implementation, a generic framework for one concrete case, or a layer that repeats the same arguments usually fails this test. Inline it.

Keep control flow flat. Adjacent layers should change the level of abstraction or hide a meaningful decision. Derive values instead of synchronizing copies. Keep mutable state in the narrowest scope possible.

Do not add speculative validators, migrations, retries, compatibility modes, configuration, or extension points. Add them when the product can produce the state or a current boundary requires them.

## Integrate new requirements cleanly

When a requirement changes an existing design, ask what the design would look like if that requirement had existed on day one. Move callers to that shape and delete the old path in the same package when the approved migration boundary allows it.

Do not preserve smooth intermediate states with permanent bridge code. It is fine for an explicitly scoped implementation phase to be incomplete if the package ends in a coherent, verified state.

## Build a lever only when it saves work

A small deterministic command is valuable when it makes a repeated edit or real check cheap and reproducible. It is waste when maintaining the helper costs as much as repeating the task. Build the smallest useful command, not a framework.

For Studi, extend the app-control verifier as real surfaces appear. Never document commands or feature-map entries for behavior the app does not have yet.

## Review for reader load

A reviewer should be able to answer these questions without reconstructing the whole repository:

- Where does this value enter the system?
- Which module owns and changes it?
- Where is the policy decision made?
- What observable effect proves success?
- What happens on the named failure path?

Block the package when unnecessary layers, duplicated sources of truth, hidden mutation, weak domain shapes, or scattered policy make those answers materially hard. Style preferences and hypothetical future requirements are not blockers.

## Subtraction pass

Before reporting completion:

1. Inspect the diff, including tests.
2. Remove unused helpers, pass-through wrappers, narration comments, duplicated checks, and speculative branches.
3. Collapse types that add ceremony without preventing a real invalid state.
4. Confirm every remaining file and test supports the approved outcome or a named risk.
5. Rerun the affected gate after subtraction.

Stop when the package is coherent and proven. The existence of more possible work is not a reason to continue.
