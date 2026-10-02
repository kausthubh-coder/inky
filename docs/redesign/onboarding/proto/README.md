# Onboarding and tour prototype

A clickable prototype, not product code. It runs on the app's own CSS, Dot and Chalky, and the preview fixtures.

1. `bun run preview:ui --no-open`
2. Open `http://127.0.0.1:4174/docs/redesign/onboarding/proto/?step=gate` (use the port the command prints).

The dark bar at the bottom right jumps to any step, makes the school check fail, or starts the tour. `node docs/redesign/onboarding/proto/walk.mjs` clicks through everything and saves screenshots to `shots/`.

- `Onboarding.tsx`: sign-in to "Your week is ready", including the animated welcome, the class link, the chat during school sign-in, the live check, and the failed check.
- `Tour.tsx`: the guided tour over the real screens, with a practice class (Studi 101), a practice assignment and a practice quiz laid over the preview fixtures.

What the live check shows is real data the scan already writes as it goes: `observedCourseIds`, the courses and assignments it records, `completedCourseIds`, `currentStep`, and exams saved with `scan_record_exam`.

During the check the right side shows the student's week, not the browser. On Canvas and Moodle the connectors read the school directly, so the page has nothing to watch; the School page tab says so. The connector lists classes and due dates in seconds, so the week fills almost at once. Reading each class then takes minutes, shown class by class. Tests land on the week in lavender and in a "Tests for Chalky" list. A day with more than three items shows "+N more", and work after this week is a count. The student can start the tour while the check keeps going.

## Built

The app now ships this design: `desktop/src/app/OnboardingScreen.tsx` and `onboarding.css` for onboarding, and `desktop/src/app/tour/` for the tour. The tour's practice class is `tour/practice.ts`, a layer over the real engine API (`studiApi.ts`) that adds Studi 101 while the tour runs and saves nothing. `tests/ui/onboarding-tour.journey.mjs` walks both against the preview fixtures.
