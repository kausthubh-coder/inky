# WP-04 + WP-05 cycle 01 manual test

Status: **FAIL at restart persistence**

## Live result before restart

- Studi opened one visible embedded school browser.
- The real `openai-codex` subscription connected and the UI showed `GPT-5.6 Sol` selected.
- The user signed in to NC State WolfWare Moodle inside Studi. The visible browser showed the authenticated `CSC 217 Fall 2026 Software Development Fundamentals Lab` course page.
- A real Pi request completed against that visible course page and returned course-specific observations, including the WolfWare Moodle platform, course identity, course URL, navigation, and notification count.
- No submission was requested or observed.

Evidence:

- `C:\Users\kaust\AppData\Local\Temp\codex-clipboard-06dd198c-8cda-4671-bc93-30768c01f90b.png`
- `C:\Users\kaust\AppData\Local\Temp\codex-clipboard-0be61e5a-ec9d-4c05-9196-6a443c0e860e.png`

## Restart failure

I stopped the running Electron process and relaunched the existing built app with `node_modules\.bin\electron.cmd .`, without rebuilding. The relaunched window retained the title `Studi — your schoolwork agent`, but after three seconds its content was still an unrelated dark page discussing Studi, homework, TikTok, and YouTube analysis. The Studi sidebar was absent and the authenticated CSC 217 Moodle page did not return.

Because the post-restart UI did not expose Studi's controls or the Moodle page, I could not verify retained Codex readiness or the Moodle login session.

## Shortest reproduction

1. Launch Studi, connect the Codex subscription, select `GPT-5.6 Sol`, and sign in to WolfWare Moodle in the visible browser.
2. Open the CSC 217 course page and run the safe inspection prompt. Confirm the course-specific agent result completes.
3. Stop Electron and relaunch the existing build.
4. Observe that the Studi window opens with unrelated browser content filling the window. The sidebar and prior Moodle page are absent.

Testing stopped at this concrete failure. I did not inspect implementation, change production code, or run programmatic suites.

## Restart retest after repair

Status: **PARTIAL PASS, profile persistence still fails**

- Relaunched the existing build directly with `node_modules\.bin\electron.cmd .`; no build or programmatic suite ran.
- The real Studi sidebar loaded instead of unrelated localhost content.
- Codex reported `Codex connected` and `OpenAI Codex is ready to use` without another provider login.
- Opening the exact prior CSC 217 URL, `https://moodle-courses2527.wolfware.ncsu.edu/course/view.php?id=13261&bp=s`, redirected to NC State Shibboleth and displayed the Unity ID/password login form.
- The persistent browser profile therefore did not reach authenticated Moodle content without another school sign-in. I entered no credentials and did not run another agent prompt.

The repaired restart-layout path passes. The package still fails its Moodle-session persistence condition.
