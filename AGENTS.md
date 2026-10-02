okay this project is studi2, not to be mistaken with an pervois app also called studi, this is a desktop app for student which finishes their homework for them, we use electorn, clerk, convex, pi, and vercel,

we create plans in html and sace it to .agent/plans,

When an HTML plan or mockup shows existing app UI, use the `existing-ui-mockups` skill (`~/.codex/skills/existing-ui-mockups/SKILL.md`). Open the relevant real UI preview first (`bun run preview:ui`, or the existing preview server). Reuse the actual React components, app CSS, fonts, Inky component, assets, and navigation; do not redraw an approximate app shell. Change only the proposed feature. Keep prototype controls outside the product UI, label simulated behavior, and compare the mockup against the existing screen at the same viewport before sharing it. Save plans under `.agent/plans`; keep mockup-only code out of production behavior. See `.agent/plans/electron-updates-preview/` for a rebuildable example.

we also test our app with test-studi skill

For Studi changes, use `.agents/skills/test-studi/SKILL.md` to choose full-app or focused verification. Exercise the affected behavior, review common failure/recovery states and code maintainability, and report actual evidence and untested limits. Use full journeys for broad changes and integrated releases, not every small edit. Keep UI actions self-explanatory and code direct; fewer lines must not come at the expense of readability or meaningful safeguards.

try to make code as high quilty as poslsible and as mannageble as pssobile,

dont be too thorugh , make code elegent,

when doing bug fixes, or addign new features insted of looking as it to add onto the existing app, think form first priciples, say we were to build the app form scrath with the new addtion in mind how would we build it ect.

we can be as ambitous with our softwarw as it wants, all software has no time or finsila cost do to ai, "boil the ocean"

also use bun not npm, and bunx not npx ect.

also the user is dumb, we have to spell it our for him in a intvitive manner, and spell it out for him with interface deisng not extra words,

the user should feel like inky is a person,

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`bunx convex ai-files install`.

<!-- convex-ai-end -->

## Codex cloud

The Ubuntu cloud container supports the controlled browser suites and the real
Electron app under Xvfb. Prepare a fresh environment with:

```bash
bash .agents/skills/test-studi/scripts/setup-studi-cloud.sh
```

Run browser journeys with `bun run test:ui:journeys`. Start and stop an isolated
desktop profile with `node scripts/start-studi-qa.mjs --persistent` and
`node scripts/stop-studi-qa.mjs`; the launcher supplies Xvfb and root's required
Electron sandbox flag automatically. Run the native controlled suite with
`xvfb-run -a bun run test:electron`.

Report cloud runs by writing a Markdown receipt under `cloud-results/`, with
screenshots beside it. Never put secrets, tokens, auth files, or raw credentials
in that directory.
