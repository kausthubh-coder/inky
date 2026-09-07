export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Use calendar arithmetic so a week stays Monday–Sunday across DST changes. */
export function calendarWeek(today: Date, offset: number) {
  const start = new Date(today);
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7 + offset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" });
  const dateLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const rangeLabel = new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric",
    ...(start.getFullYear() !== today.getFullYear() || end.getFullYear() !== today.getFullYear() ? { year: "numeric" as const } : {}),
  });
  const todayKey = localDateKey(today);
  return {
    title: offset === 0 ? "This week" : offset === -1 ? "Last week" : offset === 1 ? "Next week" : "Your week",
    range: rangeLabel.formatRange(start, end),
    days: Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = localDateKey(date);
      return { key, label: weekday.format(date), date: dateLabel.format(date), dayNumber: date.getDate(), isToday: key === todayKey };
    }),
  };
}
