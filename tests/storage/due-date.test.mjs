import assert from "node:assert/strict";
import test from "node:test";
import { parseDueDate } from "../../dist/shared/due-date.js";

const eastern = { schoolTimeZone: "America/New_York", capturedAt: "2026-09-20T16:00:00Z" };

test("missing years stay in the academic year unless the date is more than six months past", () => {
  assert.deepEqual(parseDueDate("Oct 7", eastern), {
    dueAt: "2026-10-08T03:59:59.999Z",
    precision: "date",
    timeZone: "America/New_York",
  });
  assert.deepEqual(parseDueDate("Jan 12", { ...eastern, capturedAt: "2026-12-10T16:00:00Z" }), {
    dueAt: "2027-01-13T04:59:59.999Z",
    precision: "date",
    timeZone: "America/New_York",
  });
  assert.equal(parseDueDate("Oct 7", { schoolTimeZone: "America/New_York" }), null);
});

test("date-only deadlines use the end of the school day", () => {
  const parsed = parseDueDate("September 19, 2026", eastern);
  assert.deepEqual(parsed, {
    dueAt: "2026-09-20T03:59:59.999Z",
    precision: "date",
    timeZone: "America/New_York",
  });
  assert.ok(Date.parse(parsed.dueAt) < Date.parse(eastern.capturedAt), "the date becomes overdue only after its local day ends");
});

test("wall-clock deadlines use the school IANA zone while exact offsets remain exact", () => {
  assert.deepEqual(parseDueDate("September 14, 2026 at 11:59 PM", eastern), {
    dueAt: "2026-09-15T03:59:00.000Z",
    precision: "datetime",
    timeZone: "America/New_York",
  });
  assert.deepEqual(parseDueDate("2026-09-14T23:59:00-07:00", eastern), {
    dueAt: "2026-09-15T06:59:00.000Z",
    precision: "datetime",
    timeZone: "America/New_York",
  });
  assert.deepEqual(parseDueDate("2026-09-14T23:59:00-07:00[America/Los_Angeles]", eastern), {
    dueAt: "2026-09-15T06:59:00.000Z",
    precision: "datetime",
    timeZone: "America/Los_Angeles",
  });
  assert.deepEqual(parseDueDate("September 14, 2026 at 11:59 PM (America/Los_Angeles)", eastern), {
    dueAt: "2026-09-15T06:59:00.000Z",
    precision: "datetime",
    timeZone: "America/Los_Angeles",
  });
});

test("DST gaps and folds stay unknown unless an explicit offset identifies the instant", () => {
  assert.equal(parseDueDate("March 8, 2026 at 2:30 AM", eastern), null);
  assert.equal(parseDueDate("November 1, 2026 at 1:30 AM", eastern), null);
  assert.equal(parseDueDate("2026-03-08T02:30:00-05:00[America/New_York]", eastern), null);
  assert.deepEqual(parseDueDate("2026-11-01T01:30:00-04:00[America/New_York]", eastern), {
    dueAt: "2026-11-01T05:30:00.000Z",
    precision: "datetime",
    timeZone: "America/New_York",
  });
});

test("relative weekdays require a capture date and resolve in the school zone", () => {
  assert.equal(parseDueDate("Due Friday", { schoolTimeZone: "America/New_York" }), null);
  assert.deepEqual(parseDueDate("Due Friday", {
    schoolTimeZone: "America/New_York",
    capturedAt: "2026-09-23T23:30:00Z",
  }), {
    dueAt: "2026-09-26T03:59:59.999Z",
    precision: "date",
    timeZone: "America/New_York",
  });
});

test("invalid zones, dates, weekdays, and unsupported prose stay unknown", () => {
  for (const text of ["February 30, 2026", "Friday, September 14, 2026", "sometime next week"]) {
    assert.equal(parseDueDate(text, eastern), null, text);
  }
  assert.equal(parseDueDate("September 14, 2026", { schoolTimeZone: "America/Not_A_Zone" }), null);
});
