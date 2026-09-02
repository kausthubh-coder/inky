# WP-01 cycle-4 read-only review

Reviewer task: `01a055fa-2c75-7c62-a0f0-847e285e24b0` (`WP-01 C4 final review`, `gpt-5.6-sol`, high)

Disposition: **changes_required**. The reviewer changed no files and used only two narrow in-memory checks.

Reviewed fingerprint: `5A5B3C0835F9649E6759B31C4FF6A5A59A1474A1B8C600D01CDDB34202EDDB43`.

## Blocking finding

`RequestArguments` uses `z.output<RequestSchema>`, but callers supply values accepted by `requestSchema.parse()`, which are `z.input<RequestSchema>`. With `z.string().transform(value => value.length)`, TypeScript rejects the valid string input and accepts a number that runtime rejects. Runtime accepts the string and forwards the parsed number once.

Required repair: type caller arguments with `z.input`, keep main handlers on parsed `z.output`, and retain a compile-time regression using a type-changing request schema.

## Passed and carried forward

- Runtime arity, parsing, forwarding, response validation, error propagation, freezing, channel ownership, and the two-method allowlist passed.
- Manifest derivation and the shared schema-version constant follow-ups are closed.
- WP-02 must own course-bound pattern match provenance. WP-06 must not accept agent-asserted pattern IDs.
- Later capture/export code must redact evidence summaries and opaque references.
- Preload size and source-map policy remain WP-13 work.
