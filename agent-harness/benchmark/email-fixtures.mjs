const ordinary = {
  from: "library@cedar.example.edu",
  subject: "Library hours this week",
  receivedAt: "2026-09-12T14:00:00.000Z",
  preview: "The library closes at 9 PM this week. No class deadlines have changed.",
};

const byScenario = {
  "moodle-noisy": [
    {
      from: "instructor@cedar.example.edu",
      subject: "CS 230 Exercise 05 deadline moved",
      receivedAt: "2026-09-12T15:00:00.000Z",
      preview: "Exercise 05 moved to Friday, September 18 at 11:59 PM ET. The Moodle assignment page still shows Monday, September 14; please flag the conflict until it is updated.",
    },
    ordinary,
  ],
};

export function schoolEmailFor(scenarioId) {
  return byScenario[scenarioId] ?? [ordinary];
}
