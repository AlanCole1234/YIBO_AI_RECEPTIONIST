import { localParts, toUtc, type LocalDateTimeParts } from "../../scheduling/domain/time.js";

export type NaturalDateRange = { rangeStart: string; rangeEnd: string; label: string };

/** Resolves only the short date phrases YIBO promises to callers, in clinic local time. */
export function resolveNaturalDateRange(
  expression: string,
  now: Date,
  timezone: string,
): NaturalDateRange | null {
  const normalized = expression.trim().toLowerCase().replace(/\s+/g, " ");
  const today = dateOnly(localParts(now, timezone));

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [year, month, day] = normalized.split("-").map(Number) as [number, number, number];
    return dayRange({ year, month, day, hour: 0, minute: 0 }, timezone, normalized);
  }
  if (normalized === "today") return dayRange(today, timezone, "today");
  if (normalized === "tomorrow") return dayRange(addDays(today, 1), timezone, "tomorrow");

  const thisWeekStart = upcomingWeekStart(today);
  if (normalized === "this week") return weekRange(thisWeekStart, timezone, "this week");
  if (normalized === "next week") return weekRange(addDays(thisWeekStart, 7), timezone, "next week");

  const named = normalized.match(/^(this |next )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (!named) return null;
  const modifier = named[1]?.trim();
  const weekday = weekdayByName[named[2]!]!;
  const start = modifier === "this"
    ? addDays(thisWeekStart, (weekday - weekdayOf(thisWeekStart) + 7) % 7)
    : nextOccurrence(today, weekday, modifier === "next");
  return dayRange(start, timezone, normalized);
}

const weekdayByName: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const dateOnly = (value: LocalDateTimeParts): LocalDateTimeParts => ({
  year: value.year, month: value.month, day: value.day, hour: 0, minute: 0,
});

const addDays = (value: LocalDateTimeParts, days: number): LocalDateTimeParts => {
  const next = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: 0, minute: 0 };
};

const weekdayOf = (value: LocalDateTimeParts): number =>
  new Date(Date.UTC(value.year, value.month - 1, value.day)).getUTCDay();

// On Saturday/Sunday, "this week" means the imminent Monday-to-Sunday business week.
const upcomingWeekStart = (today: LocalDateTimeParts): LocalDateTimeParts => {
  const weekday = weekdayOf(today);
  return weekday === 0 ? addDays(today, 1) : weekday === 6 ? addDays(today, 2) : addDays(today, 1 - weekday);
};

const nextOccurrence = (today: LocalDateTimeParts, weekday: number, strictlyNext: boolean): LocalDateTimeParts => {
  const offset = (weekday - weekdayOf(today) + 7) % 7;
  return addDays(today, strictlyNext && offset === 0 ? 7 : offset);
};

const dayRange = (day: LocalDateTimeParts, timezone: string, label: string): NaturalDateRange => ({
  rangeStart: toUtc(day, timezone).toISOString(),
  rangeEnd: toUtc(addDays(day, 1), timezone).toISOString(),
  label,
});

const weekRange = (start: LocalDateTimeParts, timezone: string, label: string): NaturalDateRange => ({
  rangeStart: toUtc(start, timezone).toISOString(),
  rangeEnd: toUtc(addDays(start, 7), timezone).toISOString(),
  label,
});
