# Checkpoint 02: Browser tools

Status: PASS for the section 5.2 controlled gate. The scanner's end-to-end discovery quality remains a later checkpoint.

## What changed

- Browser refs now follow CDP backend node IDs and survive snapshots and ordinary page changes. Only a real main-frame navigation or debugger detach resets them; recording reuses the last full, unfiltered observation.
- Actions return compact status/URL/title/changed summaries, including structured failure and uncertain-outcome errors. Snapshots support ref, selector, depth, and diff. The model sees the last two full snapshots; older snapshot results become one-line stubs without changing the saved transcript.
- `browser_rows` pages repeating lists with evidence refs. Frame trees are read per frame with prefixed refs and explicit unreadable-frame messages. `read_document` follows Moodle resource redirects and HTML download shims, handles forced PDF attachments, and returns page images for image-only PDFs.
- A session-level guard blocks scan-time non-GET school writes while permitting only exact named SSO/LTI hosts and enumerated Moodle read methods. It deactivates on takeover and for assignment work. Scan sessions do not receive submit or upload tools.
- Fixed the dedicated scan-browser check, current file/shell capability names, submit-pack inference, PageUp/PageDown/Home/End keys, and the evidence-snapshot search-filter leak. Updated the browser pack and assignment tool boundary.

## Gate and observed results

| Gate | Result |
| --- | --- |
| Stable refs; record without re-snapshot; clear stale error after navigation | PASS in agent tests |
| Noisy course, 130 rows in at most 3 calls | PASS, 130 in 3 native Electron calls |
| Iframe, “Submit Lab 3”, “Show more” | PASS in native Electron replay |
| Scan school POST blocked; named SSO POST allowed; zero schoolwork writes | PASS in native replay and guard tests |
| Forced PDF and image-only PDF | PASS in native replay and document tests |
| Average action result below 400 characters | PASS, **143.7 characters** over 6 actions |
| Stale refs on moodle-noisy replay | PASS, **0** |
| `test:agent`, `test:storage` | PASS, 60/60 and 170/170 |
| Assignment ownership and takeover UI | PASS, 8/8 focused tests |

The same six action results would have averaged **1,747.8 characters** if each had returned its full formatted snapshot. The compact result is **91.8% smaller** on this replay. This compares serialized result lengths, not provider tokens or an independent end-to-end scan.

## Commands and output tails

```powershell
bun run test:agent
bun run test:storage
node tests/browser-tools/browser-replay.mjs
node --test tests/ui/scan-browser-owner.test.mjs tests/ui/stop-assignment-for-scan.test.mjs
bun run typecheck
```

```text
agent:   tests 60, pass 60, fail 0
storage: tests 170, pass 170, fail 0
UI:      tests 8, pass 8, fail 0
native:  rows 130, rowCalls 3, iframeReadable true,
         submitLab3Opened true, showMoreExpanded true,
         pdfTextReadable true, imagePdfReadable true,
         schoolPostBlocked true, ssoPostAllowed true,
         staleRefErrors 0, averageActionResultChars 143.7,
         beforeStyleActionResultChars 1747.8
typecheck: exit 0
```

The first parallel regression attempt hit Windows `EBUSY` when two scripts both copied the same built agent pack. Running the required suites sequentially removed that test-harness collision. A storage expectation still named the former GPT-5.6 Sol default; it now checks the approved GPT-6 Sol default, while retaining explicit saved-model coverage.

## Limits and review

This is a controlled replay against the local synthetic Moodle course; no real school account or schoolwork was touched. Named SSO/LTI exceptions are exact-host policy inputs, not a blanket bypass. The production scanner currently supplies no school-specific exception list, so sign-in that requires a POST needs the existing student takeover path until verified hosts are configured. The full scanner benchmark was not rerun here; its workflow and quality are later checkpoints. No packaged desktop build or release was made.
