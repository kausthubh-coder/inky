---
name: verify-studi
description: Verify implemented Studi behavior through the closest real local boundary. Use while building or reviewing the desktop app; it grows with the app and must never claim controls or flows that do not exist yet.
---

# Verify Studi

Prove the behavior that exists today. Do not wait for the whole app to exist, and do not build a large verification harness ahead of it.

Use `$test-studi` instead when the requested proof is the full isolated Electron + Clerk + Convex user journey.

## Choose the closest real surface

Read the active package dossier, `package.json`, and the touched code. Pick the cheapest check that reaches the changed boundary:

- shared types or pure domain logic: the focused contract test;
- Pi `AgentSession` creation, tools, events, resume, or provider status: `npm run test:agent`;
- SQLite or Markdown persistence: `npm run test:storage` and a reopen or recovery case when that behavior changed;
- Electron main, preload, IPC, or renderer integration: `npm run test:electron`;
- visible interaction: run Studi and drive the actual Electron or browser surface, then retain one useful screenshot or state observation.

For Electron UI work, use Microsoft's official Playwright MCP over generic computer use. Start Studi with a loopback-only remote debugging port and connect Playwright MCP through its `--cdp-endpoint` option. Use structured accessibility snapshots for renderer interaction and retain one screenshot only when it adds visual evidence. Keep Studi's existing deterministic app-control receipts for durable state, restart, main-process, and policy checks. Generic computer use is a fallback only when Playwright cannot reach an OS-owned dialog or another native surface.

Use a broader command only when the change can affect the broader boundary. A successful typecheck is not proof of runtime behavior.

## Grow verification with the product

Add an app-control command or reusable fixture when the same real interaction is expensive to reproduce, easy to perform incorrectly, or needed by later packages. The command must be deterministic, safe to rerun, machine-readable where useful, and small enough to maintain.

Do not create controls for planned screens. When a new surface lands, add only the navigation, inspection, and reset capability needed to prove that surface. The existing Electron self-test is the current runtime lever; extend or replace it when live browser control becomes the cheaper proof.

## Keep evidence lean

Record the command, exit code, runtime or fixture, observed result, and artifact path when one exists. Keep the smallest reproduction for failures. Do not add large screenshots, logs, test matrices, or duplicate fixtures when one deterministic receipt proves the contract.

If no available surface can prove the behavior, report that limitation. Do not substitute seeded output or a mocked success state.
