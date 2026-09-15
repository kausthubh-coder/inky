// Reviewed incident expectations, deliberately independent of production eligibility code.
// These synthetic page observations measure recording/queue contracts, not model skill.
export const replayFixture = {
  scenarioId: "scan-incidents",
  version: 1,
  seed: 1,
  clock: "2026-09-14T12:00:00.000Z",
  courses: [
    { id: "programming", title: "Programming" },
    { id: "statistics", title: "Statistics" },
  ],
  assignments: [
    {
      id: "graded",
      course: "statistics",
      title: "Statistics HW6",
      status: "graded",
      statusText: "Graded: 10/10. All questions correct.",
      due: "2026-09-11T23:55:00.000Z",
      requirements: ["Answer all four statistics questions."],
      queue: false,
    },
    {
      id: "submitted",
      course: "programming",
      title: "Workshop 3",
      status: "submitted",
      statusText: "Submitted for grading.",
      due: "2026-09-11T23:55:00.000Z",
      requirements: ["Upload the written workshop answers."],
      queue: false,
    },
    {
      id: "closed",
      course: "programming",
      title: "Workshop 4",
      status: "not_submitted",
      statusText: "Not submitted.",
      due: "2026-09-11T23:55:00.000Z",
      late: "not_accepted",
      lateText: "Late submissions are not accepted.",
      requirements: ["Complete the coding workshop."],
      queue: false,
    },
    {
      id: "extension",
      course: "statistics",
      title: "Late statistics practice",
      status: "not_submitted",
      statusText: "Not submitted.",
      due: "2026-09-11T23:55:00.000Z",
      late: "accepted",
      lateText: "Late submissions accepted until 2026-09-18T23:55:00.000Z.",
      until: "2026-09-18T23:55:00.000Z",
      requirements: ["Explain your calculation in three sentences."],
      queue: true,
    },
    {
      id: "puzzle",
      course: "programming",
      title: "Puzzle game project",
      status: "not_submitted",
      statusText: "Not submitted.",
      due: "2026-09-20T23:55:00.000Z",
      requirements: [
        "Upload a playable HTML game.",
        "Upload a README PDF.",
        "Include a walkthrough for every level.",
      ],
      queue: true,
    },
    {
      id: "date-only",
      course: "statistics",
      title: "Statistics project proposal",
      status: "not_submitted",
      statusText: "Not submitted.",
      due: "Oct 13, 2026",
      dateOnly: true,
      requirements: ["Describe the proposed study."],
      queue: false,
    },
    {
      id: "locked",
      course: "programming",
      title: "Prerequisite workshop",
      status: "locked",
      statusText: "Locked until Workshop 4 is completed.",
      due: "2026-09-20T23:55:00.000Z",
      requirements: ["Finish the prerequisite before attempting this workshop."],
      queue: false,
    },
    {
      id: "unknown",
      course: "statistics",
      title: "External statistics homework",
      status: "unknown",
      statusText: "Submission status unavailable. Sign in to the linked system.",
      due: "2026-09-20T23:55:00.000Z",
      requirements: ["Complete the linked statistics exercise."],
      queue: false,
    },
    {
      id: "incomplete",
      course: "programming",
      title: "Programming lab",
      status: "not_submitted",
      statusText: "Not submitted.",
      due: "2026-09-20T23:55:00.000Z",
      requirements: ["Read the attached specification."],
      missing: ["The attachment could not be opened."],
      queue: false,
    },
  ],
};

export function gradeReplay(fixture, result) {
  const checks = [];
  const check = (name, passed, detail) =>
    checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) });
  const assignments = Array.isArray(result?.assignments) ? result.assignments : [];
  const courses = Array.isArray(result?.courses) ? result.courses : [];
  const queue = Array.isArray(result?.queue) ? result.queue : [];
  check("driver completed", ["completed", "succeeded"].includes(result?.status), result?.status ?? null);
  check(
    "scan completes with explicit inventories",
    result?.scanState === "succeeded",
    result?.scanState ?? null,
  );
  check(
    "every assignment persisted exactly once",
    assignments.length === fixture.assignments.length && uniqueIds(assignments, "assignmentId"),
    assignments.length,
  );
  check(
    "every course persisted exactly once",
    courses.length === fixture.courses.length && uniqueIds(courses, "courseId"),
    courses.length,
  );
  const courseMapping = new Map();
  for (const expected of fixture.courses) {
    const matches = courses.filter(
      (actual) => sourceKey(actual?.sourceTarget, "/course/view.php") === expected.id,
    );
    const actual = matches[0];
    const valid =
      matches.length === 1 && nonempty(actual?.courseId) && text(actual.label) === text(expected.title);
    check(`${expected.id}: course identity`, valid, actual ?? null);
    if (valid) courseMapping.set(expected.id, actual.courseId);
  }
  const expectedQueue = [];
  for (const expected of fixture.assignments) {
    const matches = assignments.filter(
      (actual) => sourceKey(actual?.sourceTarget, "/mod/assign/view.php") === expected.id,
    );
    const actual = matches[0];
    check(
      `${expected.id}: identity`,
      matches.length === 1 &&
        nonempty(actual?.assignmentId) &&
        text(actual.title) === text(expected.title) &&
        courseMapping.has(expected.course) &&
        actual.courseId === courseMapping.get(expected.course),
    );
    check(
      `${expected.id}: school status`,
      actual?.schoolStatus?.state === expected.status,
      actual?.schoolStatus?.state ?? null,
    );
    check(
      `${expected.id}: deadline precision`,
      expected.dateOnly
        ? actual?.dueAt == null &&
            actual?.deadlinePrecision === "date" &&
            text(actual?.dueText) === text(expected.due)
        : actual?.dueAt === expected.due &&
            (!actual?.deadlinePrecision || actual.deadlinePrecision === "datetime"),
      {
        dueAt: actual?.dueAt ?? null,
        dueText: actual?.dueText ?? null,
        precision: actual?.deadlinePrecision ?? null,
      },
    );
    if (expected.late) {
      check(
        `${expected.id}: late policy`,
        actual?.latePolicy?.state === expected.late &&
          (actual.latePolicy.until ?? null) === (expected.until ?? null),
        actual?.latePolicy ?? null,
      );
    } else {
      check(
        `${expected.id}: no invented late permission`,
        actual?.latePolicy == null ||
          (actual.latePolicy.state === "unknown" && actual.latePolicy.until == null),
        actual?.latePolicy ?? null,
      );
    }
    // Both representations retain observable text. Do not force old builds to use
    // a new schema or discard a continuous excerpt containing multiple fragments.
    const requirements = [
      actual?.instructions,
      ...(Array.isArray(actual?.requirementEvidence)
        ? actual.requirementEvidence.map((item) => item?.text)
        : []),
    ]
      .map(text)
      .filter(Boolean);
    check(
      `${expected.id}: all requirement fragments retained`,
      expected.requirements.every((fragment) =>
        requirements.some((excerpt) => excerpt.includes(text(fragment))),
      ),
      requirements,
    );
    const missing = expected.missing ?? [];
    check(
      `${expected.id}: unresolved requirements retained`,
      sameTexts(actual?.missingRequirements ?? [], missing) &&
        (missing.length ? actual?.requirementsState === "partial" : actual?.requirementsState !== "partial"),
      { state: actual?.requirementsState ?? null, missing: actual?.missingRequirements ?? null },
    );
    const queued = queue.some(
      (entry) => entry?.assignmentId === actual?.assignmentId && entry?.state === "queued",
    );
    check(`${expected.id}: queue eligibility`, queued === expected.queue, {
      expected: expected.queue,
      queued,
    });
    if (expected.queue && nonempty(actual?.assignmentId)) expectedQueue.push(actual.assignmentId);
  }
  check(
    "queue contains exactly the eligible assignments once",
    Array.isArray(result?.queue) &&
      queue.every((entry) => entry?.state === "queued") &&
      sameTexts(
        queue.map((entry) => entry?.assignmentId),
        expectedQueue,
      ),
    queue,
  );
  check(
    "no recording errors",
    Array.isArray(result?.errors) && result.errors.length === 0,
    result?.errors ?? null,
  );
  check(
    "no policy violations",
    result?.policyViolations == null ||
      (Array.isArray(result.policyViolations) && result.policyViolations.length === 0),
    result?.policyViolations ?? null,
  );
  return { passed: checks.every((item) => item.passed), checks };
}

const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const text = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const uniqueIds = (items, field) =>
  items.every((item) => nonempty(item?.[field])) &&
  new Set(items.map((item) => item[field])).size === items.length;
function sameTexts(actual, expected) {
  if (!Array.isArray(actual) || actual.some((value) => !nonempty(value))) return false;
  const a = actual.map(text).sort(),
    b = expected.map(text).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// Ignore presentation aliases such as action=editsubmission and fragments, but
// never accept another origin, route, credentials or ambiguous repeated IDs.
function sourceKey(value, path) {
  try {
    const url = new URL(value);
    return url.origin === "http://127.0.0.1:43119" &&
      !url.username &&
      !url.password &&
      url.pathname === path &&
      url.searchParams.getAll("id").length === 1
      ? url.searchParams.get("id")
      : null;
  } catch {
    return null;
  }
}
