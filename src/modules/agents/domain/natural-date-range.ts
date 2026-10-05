import { localParts, toUtc, type LocalDateTimeParts } from "../../scheduling/domain/time.js";

export type NaturalDateRange = {
  rangeStart: string;
  rangeEnd: string;
  label: string;
  resolution: {
    expressionType: "absolute_date" | "today" | "tomorrow" | "this_week" | "next_week" | "bare_weekday" | "this_weekday" | "next_weekday";
    currentLocalDate: string;
    currentLocalWeekday: number;
    requestedWeekday?: number;
    daysAhead?: number;
    resolvedLocalDate: string;
  };
};

/** Resolves only the short date phrases YIBO promises to callers, in clinic local time. */
export function resolveNaturalDateRange(
  expression: string,
  now: Date,
  timezone: string,
): NaturalDateRange | null {
  const normalized = expression.trim().toLowerCase().replace(/\s+/g, " ");
  const today = dateOnly(localParts(now, timezone));
  const currentWeekday = weekdayOf(today);

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [year, month, day] = normalized.split("-").map(Number) as [number, number, number];
    const resolved = { year, month, day, hour: 0, minute: 0 };
    return dayRange(resolved, timezone, normalized, resolution("absolute_date", today, currentWeekday, resolved));
  }
  if (normalized === "today") return dayRange(today, timezone, "today", resolution("today", today, currentWeekday, today));
  if (normalized === "tomorrow") {
    const resolved = addDays(today, 1);
    return dayRange(resolved, timezone, "tomorrow", resolution("tomorrow", today, currentWeekday, resolved));
  }

  const thisWeekStart = upcomingWeekStart(today);
  if (normalized === "this week") return weekRange(thisWeekStart, timezone, "this week", resolution("this_week", today, currentWeekday, thisWeekStart));
  if (normalized === "next week") {
    const resolved = addDays(thisWeekStart, 7);
    return weekRange(resolved, timezone, "next week", resolution("next_week", today, currentWeekday, resolved));
  }

  const named = normalized.match(/^(this |next )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (!named) return null;
  const modifier = named[1]?.trim();
  const weekday = weekdayByName[named[2]!]!;
  const start = modifier === "this"
    ? addDays(thisWeekStart, (weekday - weekdayOf(thisWeekStart) + 7) % 7)
    // A bare weekday is always strictly future. "Friday" on Friday means
    // next Friday; callers can say "today" when they mean the current day.
    : nextOccurrence(today, weekday, true);
  const expressionType = modifier === "this" ? "this_weekday" : modifier === "next" ? "next_weekday" : "bare_weekday";
  return dayRange(start, timezone, normalized, resolution(expressionType, today, currentWeekday, start, weekday));
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

const dayRange = (day: LocalDateTimeParts, timezone: string, label: string, details: NaturalDateRange["resolution"]): NaturalDateRange => ({
  rangeStart: toUtc(day, timezone).toISOString(),
  rangeEnd: toUtc(addDays(day, 1), timezone).toISOString(),
  label,
  resolution: details,
});

const weekRange = (start: LocalDateTimeParts, timezone: string, label: string, details: NaturalDateRange["resolution"]): NaturalDateRange => ({
  rangeStart: toUtc(start, timezone).toISOString(),
  rangeEnd: toUtc(addDays(start, 7), timezone).toISOString(),
  label,
  resolution: details,
});

function resolution(
  expressionType: NaturalDateRange["resolution"]["expressionType"],
  today: LocalDateTimeParts,
  currentLocalWeekday: number,
  resolved: LocalDateTimeParts,
  requestedWeekday?: number,
): NaturalDateRange["resolution"] {
  return {
    expressionType,
    currentLocalDate: localDate(today),
    currentLocalWeekday,
    ...(requestedWeekday === undefined ? {} : { requestedWeekday, daysAhead: daysBetween(today, resolved) }),
    resolvedLocalDate: localDate(resolved),
  };
}

const localDate = (value: LocalDateTimeParts): string => `${value.year.toString().padStart(4, "0")}-${value.month.toString().padStart(2, "0")}-${value.day.toString().padStart(2, "0")}`;
const daysBetween = (from: LocalDateTimeParts, to: LocalDateTimeParts): number => Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000);
