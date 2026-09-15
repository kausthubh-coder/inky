const months = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const hourMs = 60 * 60 * 1000;

// null means no IANA zone was supplied. NaN means the explicitly zoned text
// cannot identify one instant; never fall back to the computer's local zone.
export function parseZonedDeadline(text: string): number | null {
  const zone = text.match(/\(?([A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)\)?\s*$/);
  if (!zone) return null;
  const dateText = text
    .slice(0, zone.index)
    .trim()
    .replace(/\s+at\s+/i, " ");
  const date = dateText.match(
    /^(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i,
  );
  if (!date) return NaN;
  const monthName = date[1]!.toLowerCase();
  const month = months.findIndex((name) => name === monthName || name.slice(0, 3) === monthName);
  const day = Number(date[2]);
  const year = Number(date[3]);
  const hour = Number(date[4]);
  const minute = Number(date[5]);
  const second = Number(date[6] ?? 0);
  const meridiem = date[7]?.toUpperCase();
  if (
    month < 0 ||
    year < 100 ||
    day < 1 ||
    day > 31 ||
    minute > 59 ||
    second > 59 ||
    (meridiem ? hour < 1 || hour > 12 : hour > 23)
  )
    return NaN;
  const hour24 = meridiem ? (hour % 12) + (meridiem === "PM" ? 12 : 0) : hour;
  const wallTime = Date.UTC(year, month, day, hour24, minute, second);
  const calendar = new Date(wallTime);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month || calendar.getUTCDate() !== day)
    return NaN;
  const weekday = dateText.match(/^([A-Za-z]+),/)?.[1]?.toLowerCase();
  if (
    weekday &&
    ![weekdays[calendar.getUTCDay()], weekdays[calendar.getUTCDay()]!.slice(0, 3)].includes(weekday)
  )
    return NaN;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone[1],
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
  } catch {
    return NaN;
  }
  const observedWallTime = (instant: number): number => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
    return Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
  };
  // Consider both sides of a daylight-saving change. A skipped local time has
  // no candidate; a repeated local time has two. Neither permits guessing.
  const offsets = new Set(
    [-36, 0, 36].map((hours) => {
      const instant = wallTime + hours * hourMs;
      return observedWallTime(instant) - instant;
    }),
  );
  const candidates = [...offsets]
    .map((offset) => wallTime - offset)
    .filter((instant) => observedWallTime(instant) === wallTime);
  return candidates.length === 1 ? candidates[0]! : NaN;
}
