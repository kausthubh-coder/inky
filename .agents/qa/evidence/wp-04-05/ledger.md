# WP-04 + WP-05 verification ledger

Status: verified  
Final quality rating: 8.5/10  
Date: 2026-09-01

## Tasks

| Role | Task | Result |
| --- | --- | --- |
| Implementer | `01a05c88-90fe-7213-bca0-1a5914d10a11` | Visible browser, CDP controller, eight Pi tools, Codex OAuth, UI, focused checks |
| User-like tester | `01a05c9b-1686-7e91-b059-d2cacb20eb36` | Real Codex and Moodle agent turn passed; found restart renderer bug |
| Reviewer | `01a05ca1-6098-7523-8891-c1ff0d30bb09` | Diagnosed one focused repair; final approval at 8.5/10 |
| Repair implementer | `01a05ca4-6464-7f51-a7a8-3b928f282a63` | Removed ambient renderer authority; direct relaunch fixed |

## Proof

- Real `openai-codex` OAuth completed and the UI reported Codex connected.
- The user signed into NC State WolfWare Moodle inside Studi's visible `WebContentsView`.
- A real Pi `AgentSession` used Studi browser tools to inspect the authenticated CSC 217 course page and returned course-specific evidence.
- No submission was requested or observed.
- Focused agent and browser tests passed 9/9. Contract tests passed 49/49. Foundation and protected-file checks passed 12/12. The packaged Electron smoke passed.
- The repair passed 5/5 renderer-source tests, typecheck, and one production-built Electron smoke.
- Direct relaunch now loads Studi and retains Pi Codex readiness.

Screenshots:

- `C:\Users\kaust\AppData\Local\Temp\codex-clipboard-06dd198c-8cda-4671-bc93-30768c01f90b.png`
- `C:\Users\kaust\AppData\Local\Temp\codex-clipboard-0be61e5a-ec9d-4c05-9196-6a443c0e860e.png`

## Accepted limitation

A full Electron process quit ends NC State's session-scoped Moodle or Shibboleth cookie, so the user must authenticate again after explicit quit. Studi does not copy or extend identity-provider cookies. WP-08 will implement the normal tray-owned lifecycle so closing the window keeps the Electron process and school session alive.

No additional implementation pass is required.
