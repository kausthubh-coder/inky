# WP-03 verification ledger

Package: WP-03 Pi runtime  
Final cycle: 1  
Date: 2026-09-01  
Disposition: verified; stop for user review

## Role tasks

| Role | Codex task | Result | Evidence |
| --- | --- | --- | --- |
| Implementer | `01a05be7-50fe-7313-bfed-b8672b69f62b` | Implemented the real Pi boundary and focused tests | [cycle-01-implement.md](cycle-01-implement.md) |
| Independent tester | `01a05c00-f0ad-7280-abf8-88bab9086db2` | PASS; production unchanged; one useful failure-boundary test added | [cycle-01-test.md](cycle-01-test.md) |
| Read-only reviewer | `01a05c11-0d18-73b2-82e8-4b80ef0340d8` | `approve_with_followups`; no blocker | [final-review.md](final-review.md) |

All three tasks used `gpt-5.6-sol` with high reasoning and normal execution speed.

## Verified working state

This saved project has no Git metadata. The independently tested production state is identified by SHA-256 hashes:

| File | SHA-256 |
| --- | --- |
| `package.json` | `FBB8D54E023AA3BA94F91DE0C30D642267C64B757A3DCA2BB5ED2AB6E5DEBBD7` |
| `package-lock.json` | `7783B57FDDB8CD14E3FE300480AB53F5A836974F83C0CAC8A66DE59493CBD790` |
| `shared/agent-runtime.ts` | `C1572FDC55618C4C56A7D45D2C0EB3B7EBD825711836168B42ADC6A021453EE1` |
| `electron/agent/runtime.ts` | `67DCC551161E5E782957293FE6718D175487A1327D9568916B1774CF898258CD` |
| `electron/main.ts` | `898E3236178365F5E23DB7DA59BCF688E1FB80AF162EF421D81B99D8F16EDB28` |
| `tests/agent/agent-runtime.test.mjs` | `2FB253A8E9C1EC52CD6DF4C5B23D9517DF690379B033400AA15D27B5263A3FD7` |

The four protected Sites source hashes remained byte-identical. See the tester report for the complete source and protected-file hash table.

## Final gates

| Gate | Result |
| --- | --- |
| Focused Pi runtime | `npm run test:agent` → exit 0, 4/4 passed |
| Electron runtime | `npm run test:electron` → exit 0 |
| Electron receipt | Electron 37.10.3 / Node 22.21.1 / Pi 0.84.4; persisted and resumed session; probe completed; active tools exactly `studi_probe`; provider output redacted |
| Earlier contracts | 49/49 passed in independent test |
| Foundation | 12/12 passed in independent test |
| Storage | 27/27 passed in independent test |
| Sites handoff | build passed, 4/4 Sites tests passed in independent test |

## Failure and correction

The first Electron proof tried to resume an untouched empty Pi session. Pi had not persisted that session yet, so a new ID was expected. The implementation was corrected to complete a deterministic `studi_probe` turn first, prove the JSONL session exists, then resume and verify the same session ID. No product workaround or seeded success remains.

A real too-small compaction correctly failed with `Nothing to compact`; the normalized stream reported compaction start followed by failed completion. Successful compaction mapping is tested without purchasing a model turn.

## Quality decision

The 656-line runtime remains one file because it is one traceable control flow: public boundary, Pi construction, session ownership, normalization, then deterministic fake. The independent reviewer found no second owner, unnecessary provider framework, unrestricted Pi tool, credential leak, or useful split today.

Packaging follow-up: decide whether the faux-provider self-test must ship. If not, move the direct `@earendil-works/pi-ai` dependency to development/test scope and confirm the packaged tree has only Pi's required runtime copy.

WP-03 is complete. No WP-04 work was opened.
