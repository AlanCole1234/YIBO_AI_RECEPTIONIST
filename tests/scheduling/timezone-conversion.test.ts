import { describe, expect, it } from "vitest";
import { localParts, toUtc } from "../../src/modules/scheduling/domain/time.js";

describe("business timezone conversion", () => {
  it("converts the same 11:00 AM local appointment to different UTC instants", () => {
    const localAppointment = { year: 2026, month: 8, day: 24, hour: 11, minute: 0 };
    const chicago = toUtc(localAppointment, "America/Chicago");
    const denver = toUtc(localAppointment, "America/Denver");

    expect(chicago.toISOString()).toBe("2026-08-24T16:00:00.000Z");
    expect(denver.toISOString()).toBe("2026-08-24T17:00:00.000Z");
    expect(localParts(chicago, "America/Chicago")).toMatchObject({ hour: 11, minute: 0 });
    expect(localParts(denver, "America/Denver")).toMatchObject({ hour: 11, minute: 0 });
  });

  it("uses IANA timezone rules across daylight saving time", () => {
    const beforeDst = toUtc({ year: 2026, month: 3, day: 7, hour: 11, minute: 0 }, "America/Denver");
    const afterDst = toUtc({ year: 2026, month: 3, day: 9, hour: 11, minute: 0 }, "America/Denver");

    expect(beforeDst.toISOString()).toBe("2026-03-07T18:00:00.000Z");
    expect(afterDst.toISOString()).toBe("2026-03-09T17:00:00.000Z");
  });
});
