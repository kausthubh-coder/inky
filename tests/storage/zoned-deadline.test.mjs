import assert from "node:assert/strict";
import test from "node:test";
import { parseZonedDeadline } from "../../dist/electron/scan/zoned-deadline.js";

test("explicit IANA deadlines convert their wall-clock date using the source zone", () => {
  for (const [text, expected] of [
    ["September 14, 2026 at 11:59 PM America/New_York", "2026-09-15T03:59:00.000Z"],
    ["January 14, 2026 at 11:59 PM America/New_York", "2026-01-15T04:59:00.000Z"],
    ["September 14, 2026 at 11:59 PM Asia/Kolkata", "2026-09-14T18:29:00.000Z"],
    ["September 14, 2026 at 12:00 AM America/New_York", "2026-09-14T04:00:00.000Z"],
    ["Monday, September 14, 2026 at 12:00 PM (America/New_York)", "2026-09-14T16:00:00.000Z"],
    ["Sep 14, 2026 23:59:15 America/New_York", "2026-09-15T03:59:15.000Z"],
  ])
    assert.equal(new Date(parseZonedDeadline(text)).toISOString(), expected, text);
});

test("zoned deadlines reject invalid, skipped, repeated or underspecified local dates", () => {
  for (const text of [
    "March 8, 2026 at 2:30 AM America/New_York",
    "November 1, 2026 at 1:30 AM America/New_York",
    "February 30, 2026 at 11:59 PM America/New_York",
    "Friday, September 14, 2026 at 11:59 PM America/New_York",
    "September 14, 2026 at 13:59 PM America/New_York",
    "September 14, 2026 at 11:60 PM America/New_York",
    "September 14, 2026 at 11:59 PM America/Not_A_Zone",
    "September 14 at 11:59 PM America/New_York",
    "September 14, 2026 America/New_York",
  ])
    assert.equal(Number.isNaN(parseZonedDeadline(text)), true, text);
  assert.equal(parseZonedDeadline("2026-09-14T23:59:00-04:00"), null);
});
