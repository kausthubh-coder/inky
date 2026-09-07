import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarWeek, localDateKey } from "../../desktop/src/app/weekCalendar.ts";

test("Sunday belongs to the full Monday–Sunday week, including both weekend days", () => {
  const week = calendarWeek(new Date(2026, 8, 6, 23, 30), 0);
  assert.deepEqual(week.days.map((day) => day.key), [
    "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06",
  ]);
  assert.deepEqual(week.days.filter((day) => day.isToday).map((day) => day.key), ["2026-09-06"]);
});

test("navigation crosses year boundaries and never marks another week as today", () => {
  const today = new Date(2026, 0, 1);
  const previous = calendarWeek(today, -1);
  const current = calendarWeek(today, 0);
  const next = calendarWeek(today, 1);
  assert.equal(previous.days[0].key, "2025-12-22");
  assert.equal(current.days[0].key, "2025-12-29");
  assert.equal(next.days[0].key, "2026-01-05");
  assert.equal(previous.days.some((day) => day.isToday), false);
  assert.equal(next.days.some((day) => day.isToday), false);
  assert.match(current.range, /2025/);
  assert.match(current.range, /2026/);
  assert.equal(calendarWeek(today, 52).days[0].key, "2026-12-28");
  assert.equal(calendarWeek(today, -52).days[0].key, "2024-12-30");
});

test("weeks remain consecutive local dates through leap days and both daylight-saving changes", () => {
  for (const today of [new Date(2028, 1, 29), new Date(2026, 2, 8), new Date(2026, 10, 1)]) {
    const original = today.getTime();
    for (const offset of [-1, 0, 1]) {
      const week = calendarWeek(today, offset);
      assert.equal(new Set(week.days.map((day) => day.key)).size, 7);
      const [year, month, day] = week.days[0].key.split("-").map(Number);
      const expected = new Date(year, month - 1, day, 12);
      assert.equal(expected.getDay(), 1);
      for (const date of week.days) {
        assert.equal(date.key, localDateKey(expected));
        expected.setDate(expected.getDate() + 1);
      }
      assert.equal(calendarWeek(today, offset + 1).days[0].key, localDateKey(expected));
    }
    assert.equal(today.getTime(), original);
  }
});
