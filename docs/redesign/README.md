# Studi redesign: mock and plan

Design exploration only. Nothing here ships in the app, and no production code changes.

| File | What it is |
|---|---|
| `concept.html` | Clickable mock of the redesigned app. Tabs along the top switch screens. The row under them switches states. |
| `plan.html` | How the current app works, what each part of the new UI needs, how Learn becomes real, fake school additions, 42 test stories, and nine build phases. |
| `learn-concept.html` | Clickable mock of the new Learn dashboard and tutor session. Build notes under each frame name the data and rule for every part. States are linkable: `#learn/empty`, `#learn/exams`, `#tutor/scene`. |
| `learn-plan.html` | Learn build plan: data model, tutor phases and tools, visuals, practice tests, harness, user stories with expected behaviour, build order. `LEARN-PLAN.md` is the earlier text draft. |
| `scan-plan.html` | Scanner audit (why a real scan took 99 minutes), comparison with other agent browsers, new scan design, scan stories, and one build order covering scanning and Learn. |
| `SPEC.md` | How each part decides what to show, and the data behind it. |
| `inky.js`, `inky.css` | Inky's artwork and animations, copied from `desktop/shared/inky.ts` and `desktop/src/app/app.css` so the mock uses the real mascot. |

## Open it

The pages load fonts from `node_modules`, so serve the repo root after `bun install`:

```bash
bun -e 'Bun.serve({port:4180,hostname:"127.0.0.1",async fetch(r){const f=Bun.file("."+decodeURIComponent(new URL(r.url).pathname));return (await f.exists())?new Response(f):new Response("not found",{status:404})}})'
```

Then open `http://127.0.0.1:4180/docs/redesign/concept.html`.

States are linkable, for example `#assignment/working`, `#assignment/ready/code`, `#today/auto`, `#learn/nosyllabus`.

## Known to be invented in the mock

Readiness percentages, planned start times such as "Inky starts Thu 7 PM", and the Claude import button. The plan marks each of these as new work or unverified.
