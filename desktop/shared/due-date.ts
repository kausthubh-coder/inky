const monthNumbers = new Map([
  ["jan", 1], ["january", 1],
  ["feb", 2], ["february", 2],
  ["mar", 3], ["march", 3],
  ["apr", 4], ["april", 4],
  ["may", 5],
  ["jun", 6], ["june", 6],
  ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8],
  ["sep", 9], ["sept", 9], ["september", 9],
  ["oct", 10], ["october", 10],
  ["nov", 11], ["november", 11],
  ["dec", 12], ["december", 12],
]);

const weekdayNumbers = new Map([
  ["sun", 0], ["sunday", 0],
  ["mon", 1], ["monday", 1],
  ["tue", 2], ["tues", 2], ["tuesday", 2],
  ["wed", 3], ["wednesday", 3],
  ["thu", 4], ["thur", 4], ["thurs", 4], ["thursday", 4],
  ["fri", 5], ["friday", 5],
  ["sat", 6], ["saturday", 6],
]);

const dayMs = 24 * 60 * 60 * 1_000;

export type DueDatePrecision = "date" | "datetime";
export type DueDateCapture = string | number | Date;

export interface DueDateParseOptions {
  /** IANA zone used when the source text does not name its own zone. */
  schoolTimeZone: string;
  /** IANA zone supplied separately by the source, such as a linked system. */
  sourceTimeZone?: string;
  /** When the page was captured. Required to resolve a missing year or relative date. */
  capturedAt?: DueDateCapture;
}

export interface ParsedDueDate {
  dueAt: string;
  precision: DueDatePrecision;
  /** Canonical IANA zone used to interpret a wall-clock date. */
  timeZone: string;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

interface WallTime extends CalendarDate {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

interface ParsedTime {
  hour: number;
  minute: number;
  second: number;
}

interface DateParts {
  date: CalendarDate;
  weekday?: number;
  time?: ParsedTime;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function parseDueDate(text: string, options: DueDateParseOptions): ParsedDueDate | null {
  if (!text.trim()) return null;

  const schoolTimeZone = canonicalTimeZone(options.schoolTimeZone);
  if (!schoolTimeZone) return null;

  const normalized = text.trim().replace(/\s+/g, " ").replace(/^due(?:\s+date)?\s*:?\s*/i, "");
  const namedZone = takeTrailingTimeZone(normalized);
  const sourceZoneText = namedZone?.timeZone ?? options.sourceTimeZone;
  const sourceTimeZone = sourceZoneText === undefined ? undefined : canonicalTimeZone(sourceZoneText);
  if (sourceZoneText !== undefined && !sourceTimeZone) return null;

  const timeZone = sourceTimeZone ?? schoolTimeZone;
  const dateText = namedZone?.text ?? normalized;
  const capturedDate = captureDate(options.capturedAt, timeZone);
  const iso = parseIsoDate(dateText, timeZone, sourceTimeZone !== undefined);
  if (iso) return iso;

  const relative = parseRelativeDate(dateText, capturedDate);
  const absolute = relative ?? parseCalendarDate(dateText, capturedDate);
  if (!absolute || !isCalendarDate(absolute.date)) return null;
  if (absolute.weekday !== undefined && weekdayOf(absolute.date) !== absolute.weekday) return null;

  const precision: DueDatePrecision = absolute.time ? "datetime" : "date";
  const wallTime: WallTime = {
    ...absolute.date,
    ...(absolute.time ?? { hour: 23, minute: 59, second: 59 }),
    millisecond: absolute.time ? 0 : 999,
  };
  const instant = wallTimeToInstant(wallTime, timeZone);
  return instant === null ? null : { dueAt: new Date(instant).toISOString(), precision, timeZone };
}

/**
 * Compatibility contract for the old scan-local parser. `null` means the text
 * did not supply an IANA zone; `NaN` means it did, but not as one exact instant.
 */
export function parseZonedDeadline(text: string): number | null {
  const namedZone = takeTrailingTimeZone(text.trim().replace(/\s+/g, " "));
  if (!namedZone) return null;
  const parsed = parseDueDate(text, { schoolTimeZone: namedZone.timeZone });
  return parsed?.precision === "datetime" ? Date.parse(parsed.dueAt) : NaN;
}

function parseIsoDate(text: string, timeZone: string, validateNamedZone: boolean): ParsedDueDate | null {
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/i);
  if (!match) return null;

  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (!isCalendarDate(date)) return null;
  if (match[4] === undefined) {
    const instant = wallTimeToInstant({ ...date, hour: 23, minute: 59, second: 59, millisecond: 999 }, timeZone);
    return instant === null ? null : { dueAt: new Date(instant).toISOString(), precision: "date", timeZone };
  }

  const wallTime: WallTime = {
    ...date,
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
    millisecond: Number((match[7] ?? "").padEnd(3, "0")),
  };
  if (!isWallTime(wallTime)) return null;

  const offset = match[8];
  if (!offset) {
    const instant = wallTimeToInstant(wallTime, timeZone);
    return instant === null ? null : { dueAt: new Date(instant).toISOString(), precision: "datetime", timeZone };
  }

  const normalizedOffset = /^[+-]\d{4}$/.test(offset) ? `${offset.slice(0, 3)}:${offset.slice(3)}` : offset.toUpperCase();
  const fraction = match[7] === undefined ? "" : `.${match[7]}`;
  const instant = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? "00"}${fraction}${normalizedOffset}`);
  if (!Number.isFinite(instant)) return null;
  if (validateNamedZone && !sameWallTime(partsAt(instant, timeZone), wallTime)) return null;
  return { dueAt: new Date(instant).toISOString(), precision: "datetime", timeZone };
}

function parseCalendarDate(text: string, capturedDate: CalendarDate | null): DateParts | null {
  const cleaned = text.replace(/\s+at\s+/i, " ").replace(/\.$/, "").trim();
  const monthFirst = cleaned.match(/^(?:(\w+),?\s+)?([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?:,?\s+(.+))?$/i);
  if (monthFirst) {
    const month = monthNumbers.get(monthFirst[2]!.toLowerCase());
    if (month) return finishCalendarDate(monthFirst[1], month, Number(monthFirst[3]), monthFirst[4], monthFirst[5], capturedDate);
  }

  const dayFirst = cleaned.match(/^(?:(\w+),?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?(?:,?\s+(\d{4}))?(?:,?\s+(.+))?$/i);
  if (dayFirst) {
    const month = monthNumbers.get(dayFirst[3]!.toLowerCase());
    if (month) return finishCalendarDate(dayFirst[1], month, Number(dayFirst[2]), dayFirst[4], dayFirst[5], capturedDate);
  }

  const numeric = cleaned.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?:,?\s+(.+))?$/);
  if (numeric) return finishCalendarDate(undefined, Number(numeric[1]), Number(numeric[2]), numeric[3], numeric[4], capturedDate);
  return null;
}

function finishCalendarDate(
  weekdayText: string | undefined,
  month: number,
  day: number,
  yearText: string | undefined,
  timeText: string | undefined,
  capturedDate: CalendarDate | null,
): DateParts | null {
  const weekday = weekdayText === undefined ? undefined : weekdayNumbers.get(weekdayText.toLowerCase());
  if (weekdayText !== undefined && weekday === undefined) return null;
  const year = yearText === undefined ? inferAcademicYear(month, day, capturedDate) : Number(yearText);
  if (year === null) return null;
  const time = timeText === undefined ? undefined : parseTime(timeText);
  if (time === null) return null;
  return {
    date: { year, month, day },
    ...(weekday === undefined ? {} : { weekday }),
    ...(time === undefined ? {} : { time }),
  };
}

function parseRelativeDate(text: string, capturedDate: CalendarDate | null): DateParts | null {
  if (!capturedDate) return null;
  const match = text.replace(/\s+at\s+/i, " ").replace(/\.$/, "").trim()
    .match(/^(today|tomorrow|(?:this\s+|next\s+)?[A-Za-z]+)(?:,?\s+(.+))?$/i);
  if (!match) return null;

  const relative = match[1]!.toLowerCase();
  let daysAhead: number;
  if (relative === "today") daysAhead = 0;
  else if (relative === "tomorrow") daysAhead = 1;
  else {
    const next = relative.startsWith("next ");
    const weekdayText = relative.replace(/^(?:this|next)\s+/, "");
    const weekday = weekdayNumbers.get(weekdayText);
    if (weekday === undefined) return null;
    daysAhead = (weekday - weekdayOf(capturedDate) + 7) % 7;
    if (next) daysAhead += 7;
  }

  const time = match[2] === undefined ? undefined : parseTime(match[2]);
  if (time === null) return null;
  const date = addCalendarDays(capturedDate, daysAhead);
  return { date, ...(time === undefined ? {} : { time }) };
}

function parseTime(text: string): ParsedTime | null {
  const match = text.trim().match(/^(\d{1,2})(?::(\d{2})(?::(\d{2}))?)?\s*(am|pm)?$/i);
  if (!match || (match[2] === undefined && match[4] === undefined)) return null;
  const rawHour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const second = Number(match[3] ?? 0);
  const meridiem = match[4]?.toLowerCase();
  if (minute > 59 || second > 59 || (meridiem ? rawHour < 1 || rawHour > 12 : rawHour > 23)) return null;
  const hour = meridiem ? rawHour % 12 + (meridiem === "pm" ? 12 : 0) : rawHour;
  return { hour, minute, second };
}

function inferAcademicYear(month: number, day: number, capturedDate: CalendarDate | null): number | null {
  if (!capturedDate) return null;
  const candidate = { year: capturedDate.year, month, day };
  const cutoff = shiftCalendarMonths(capturedDate, -6);
  return compareCalendarDates(candidate, cutoff) < 0 ? capturedDate.year + 1 : capturedDate.year;
}

function captureDate(value: DueDateCapture | undefined, timeZone: string): CalendarDate | null {
  if (value === undefined) return null;
  if (typeof value === "string") {
    const localDate = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (localDate) {
      const date = { year: Number(localDate[1]), month: Number(localDate[2]), day: Number(localDate[3]) };
      return isCalendarDate(date) ? date : null;
    }
  }
  const instant = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  const parts = partsAt(instant, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function takeTrailingTimeZone(text: string): { text: string; timeZone: string } | null {
  const match = text.match(/\s*(?:\(|\[)?((?:[A-Za-z_+-]+(?:\/[A-Za-z0-9._+-]+)+)|UTC)(?:\)|\])?\s*$/i);
  if (!match || match.index === undefined) return null;
  return { text: text.slice(0, match.index).trim(), timeZone: match[1]! };
}

function canonicalTimeZone(timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function partsAt(instant: number, timeZone: string): WallTime {
  const values = Object.fromEntries(formatterFor(timeZone).formatToParts(instant).map(part => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    millisecond: new Date(instant).getUTCMilliseconds(),
  };
}

function wallTimeToInstant(wallTime: WallTime, timeZone: string): number | null {
  if (!isWallTime(wallTime)) return null;
  const asUtc = Date.UTC(wallTime.year, wallTime.month - 1, wallTime.day, wallTime.hour, wallTime.minute, wallTime.second, wallTime.millisecond);
  const offsets = new Set<number>();
  for (let hours = -72; hours <= 72; hours += 6) {
    const sample = Math.trunc((asUtc + hours * 60 * 60_000) / 1_000) * 1_000;
    const observed = partsAt(sample, timeZone);
    offsets.add(Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second) - sample);
  }
  const candidates = [...offsets]
    .map(offset => asUtc - offset)
    .filter(instant => sameWallTime(partsAt(instant, timeZone), wallTime));
  return new Set(candidates).size === 1 ? candidates[0]! : null;
}

function isCalendarDate(date: CalendarDate): boolean {
  if (!Number.isInteger(date.year) || date.year < 100 || date.year > 9_999
    || !Number.isInteger(date.month) || date.month < 1 || date.month > 12
    || !Number.isInteger(date.day) || date.day < 1 || date.day > 31) return false;
  const check = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return check.getUTCFullYear() === date.year && check.getUTCMonth() === date.month - 1 && check.getUTCDate() === date.day;
}

function isWallTime(wallTime: WallTime): boolean {
  return isCalendarDate(wallTime)
    && Number.isInteger(wallTime.hour) && wallTime.hour >= 0 && wallTime.hour <= 23
    && Number.isInteger(wallTime.minute) && wallTime.minute >= 0 && wallTime.minute <= 59
    && Number.isInteger(wallTime.second) && wallTime.second >= 0 && wallTime.second <= 59
    && Number.isInteger(wallTime.millisecond) && wallTime.millisecond >= 0 && wallTime.millisecond <= 999;
}

function sameWallTime(left: WallTime, right: WallTime): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day
    && left.hour === right.hour && left.minute === right.minute && left.second === right.second
    && left.millisecond === right.millisecond;
}

function weekdayOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function shiftCalendarMonths(date: CalendarDate, months: number): CalendarDate {
  const absoluteMonth = date.year * 12 + date.month - 1 + months;
  const year = Math.floor(absoluteMonth / 12);
  const month = absoluteMonth - year * 12 + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(date.day, lastDay) };
}

function compareCalendarDates(left: CalendarDate, right: CalendarDate): number {
  return Date.UTC(left.year, left.month - 1, left.day) - Date.UTC(right.year, right.month - 1, right.day);
}
