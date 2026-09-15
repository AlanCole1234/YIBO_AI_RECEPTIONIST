import { describe, expect, it } from "vitest";
import { resolveNaturalDateRange } from "../../src/modules/agents/domain/natural-date-range.js";

const now = new Date("2026-08-30T18:00:00.000Z"); // Sunday afternoon in El Paso.
const timezone = "America/Denver";

describe("resolveNaturalDateRange", () => {
  it("resolves this week to the imminent Monday-to-Monday business week on a Sunday", () => {
    expect(resolveNaturalDateRange("this week", now, timezone)).toMatchObject({
      rangeStart: "2026-08-31T06:00:00.000Z",
      rangeEnd: "2026-09-07T06:00:00.000Z",
      label: "this week",
    });
  });

  it("resolves next week after the imminent business week", () => {
    expect(resolveNaturalDateRange("next week", now, timezone)).toMatchObject({
      rangeStart: "2026-09-07T06:00:00.000Z",
      rangeEnd: "2026-09-14T06:00:00.000Z",
      label: "next week",
    });
  });

  it.each([
    ["Monday", "2026-08-31T06:00:00.000Z"],
    ["this Friday", "2026-09-04T06:00:00.000Z"],
    ["next Monday", "2026-08-31T06:00:00.000Z"],
  ])("resolves %s from the actual clinic-local date", (expression, rangeStart) => {
    expect(resolveNaturalDateRange(expression, now, timezone)).toMatchObject({ rangeStart });
  });

  it("keeps today, tomorrow, this week, and Friday correct across a year boundary", () => {
    const yearEnd = new Date("2026-12-31T18:00:00.000Z"); // Thursday morning in Denver.

    expect(resolveNaturalDateRange("today", yearEnd, timezone)).toMatchObject({
      rangeStart: "2026-12-31T07:00:00.000Z", rangeEnd: "2027-01-01T07:00:00.000Z",
    });
    expect(resolveNaturalDateRange("tomorrow", yearEnd, timezone)).toMatchObject({
      rangeStart: "2027-01-01T07:00:00.000Z", rangeEnd: "2027-01-02T07:00:00.000Z",
    });
    expect(resolveNaturalDateRange("this Friday", yearEnd, timezone)).toMatchObject({
      rangeStart: "2027-01-01T07:00:00.000Z", rangeEnd: "2027-01-02T07:00:00.000Z",
    });
    expect(resolveNaturalDateRange("this week", yearEnd, timezone)).toMatchObject({
      rangeStart: "2026-12-28T07:00:00.000Z", rangeEnd: "2027-01-04T07:00:00.000Z",
    });
  });

  it("treats a bare weekday as strictly future in the clinic timezone", () => {
    const fridayInDenver = new Date("2026-09-04T18:00:00.000Z");
    expect(resolveNaturalDateRange("Friday", fridayInDenver, timezone)).toMatchObject({
      rangeStart: "2026-09-11T06:00:00.000Z",
      resolution: expect.objectContaining({ expressionType: "bare_weekday", daysAhead: 7, resolvedLocalDate: "2026-09-11" }),
    });
    expect(resolveNaturalDateRange("today", fridayInDenver, timezone)).toMatchObject({
      rangeStart: "2026-09-04T06:00:00.000Z",
    });
    // "this Friday" intentionally retains its explicit current-week meaning.
    expect(resolveNaturalDateRange("this Friday", fridayInDenver, timezone)).toMatchObject({
      rangeStart: "2026-09-04T06:00:00.000Z",
      resolution: expect.objectContaining({ expressionType: "this_weekday", daysAhead: 0 }),
    });
  });

  it("uses the clinic-local weekday near UTC midnight", () => {
    // It is still Thursday evening in Denver even though UTC is already Friday.
    const utcFriday = new Date("2026-09-04T01:30:00.000Z");
    expect(resolveNaturalDateRange("Friday", utcFriday, timezone)).toMatchObject({
      rangeStart: "2026-09-04T06:00:00.000Z",
      resolution: expect.objectContaining({ currentLocalDate: "2026-09-03", currentLocalWeekday: 4, daysAhead: 1 }),
    });
  });
});
