import type { OpeningHoursRule } from "../../business/index.js";

export interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timezone: string): Intl.DateTimeFormat => {
  const existing = formatterCache.get(timezone);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timezone, formatter);
  return formatter;
};

export const localParts = (date: Date, timezone: string): LocalDateTimeParts => {
  const parts = formatterFor(timezone).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
};

export const toUtc = (local: LocalDateTimeParts, timezone: string): Date => {
  const guessedUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const rendered = localParts(new Date(guessedUtc), timezone);
  const offsetCorrection = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute)
    - Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute);
  return new Date(guessedUtc + offsetCorrection);
};

export const minuteOfDay = (time: string): number => {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
};

export const rulesForDay = (rules: OpeningHoursRule[], dayOfWeek: number): OpeningHoursRule[] =>
  rules.filter((rule) => rule.dayOfWeek === dayOfWeek);

export const intersects = (start: Date, end: Date, intervals: Array<{ startAt: string; endAt: string }>): boolean =>
  intervals.some((interval) => {
    const intervalStart = new Date(interval.startAt);
    const intervalEnd = new Date(interval.endAt);
    return intervalStart < end && start < intervalEnd;
  });
