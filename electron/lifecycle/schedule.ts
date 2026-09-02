import { AutomationScheduleSchema, STUDI_SCHEMA_VERSION, type AutomationSchedule } from "../../shared/index.js";

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

export function createAutomationSchedule(
  cadence: AutomationSchedule["cadence"],
  timezone: string,
  now: string,
  previous: AutomationSchedule | null = null,
  requested: { readonly localTime?: string; readonly weekday?: number } = {},
): AutomationSchedule {
  assertTimezone(timezone);
  const local = localParts(Date.parse(now), timezone);
  const localTime = requested.localTime ?? previous?.localTime ?? `${pad(local.hour)}:${pad(local.minute)}`;
  const weekday = cadence === "weekly" ? requested.weekday ?? previous?.weekday ?? local.weekday : undefined;
  const draft = AutomationScheduleSchema.parse({
    schemaVersion: STUDI_SCHEMA_VERSION,
    scheduleId: "school-scan",
    cadence,
    state: previous?.state ?? "enabled",
    timezone,
    localTime,
    ...(weekday === undefined ? {} : { weekday }),
    updatedAt: now,
  });
  return cadence === "manual"
    ? draft
    : AutomationScheduleSchema.parse({ ...draft, nextRunAt: nextScheduleRun(draft, now) });
}

export function nextScheduleRun(schedule: AutomationSchedule, after: string): string {
  if (schedule.cadence === "manual") throw new Error("Manual schedules do not have a next run");
  assertTimezone(schedule.timezone);
  const afterMs = Date.parse(after);
  if (!Number.isFinite(afterMs)) throw new TypeError("Schedule boundary must be an ISO timestamp");
  const [hour, minute] = schedule.localTime.split(":").map(Number) as [number, number];
  const localAfter = localParts(afterMs, schedule.timezone);

  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const date = new Date(Date.UTC(localAfter.year, localAfter.month - 1, localAfter.day + dayOffset));
    const target = {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour,
      minute,
      weekday: date.getUTCDay(),
    };
    if (schedule.cadence === "weekly" && target.weekday !== schedule.weekday) continue;
    const instant = findWallClockInstant(target, schedule.timezone, afterMs);
    if (instant !== null) return new Date(instant).toISOString();
  }
  throw new Error("Could not calculate the next schedule occurrence");
}

function findWallClockInstant(target: LocalParts, timezone: string, afterMs: number): number | null {
  const center = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  const offsets = new Set<number>();
  for (let sample = center - 48 * 60 * 60_000; sample <= center + 48 * 60 * 60_000; sample += 6 * 60 * 60_000) {
    const parts = localParts(sample, timezone);
    offsets.add(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - sample);
  }
  const wallClockCandidates = [...offsets]
    .map((offset) => center - offset)
    .filter((instant) => sameWallClock(localParts(instant, timezone), target))
    .sort((left, right) => left - right);
  if (wallClockCandidates.length > 0) {
    return wallClockCandidates.find((instant) => instant > afterMs) ?? null;
  }

  let firstAfterGap: number | null = null;
  const targetMinute = target.hour * 60 + target.minute;
  for (const candidate of [...offsets].map((offset) => center - offset)) {
    for (let instant = candidate - 3 * 60 * 60_000; instant <= candidate + 3 * 60 * 60_000; instant += 60_000) {
      if (instant <= afterMs) continue;
      const parts = localParts(instant, timezone);
      if (parts.year !== target.year || parts.month !== target.month || parts.day !== target.day) continue;
      if (parts.hour * 60 + parts.minute > targetMinute && (firstAfterGap === null || instant < firstAfterGap)) firstAfterGap = instant;
    }
  }
  return firstAfterGap;
}

function sameWallClock(left: LocalParts, right: LocalParts): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day && left.hour === right.hour && left.minute === right.minute;
}

function localParts(instant: number, timezone: string): LocalParts {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(new Date(instant)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.weekday ?? "");
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday,
  };
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw new TypeError(`Unknown IANA timezone: ${timezone}`);
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
