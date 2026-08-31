import { describe, expect, it } from "vitest";
import { resolveNaturalDateRange } from "../../src/modules/agents/domain/natural-date-range.js";

const now = new Date("2026-08-30T18:00:00.000Z"); // Sunday afternoon in El Paso.
const timezone = "America/Denver";

describe("resolveNaturalDateRange", () => {
  it("resolves this week to the imminent Monday-to-Monday business week on a Sunday", () => {
    expect(resolveNaturalDateRange("this week", now, timezone)).toEqual({
      rangeStart: "2026-08-31T06:00:00.000Z",
      rangeEnd: "2026-09-07T06:00:00.000Z",
      label: "this week",
    });
  });

  it("resolves next week after the imminent business week", () => {
    expect(resolveNaturalDateRange("next week", now, timezone)).toEqual({
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
});
