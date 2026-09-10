import { describe, expect, it } from "vitest";
import { DEVELOPMENT_BUSINESS } from "../../src/app/development-fixtures.js";
import { BusinessDirectoryService, InMemoryBusinessRepository } from "../../src/modules/business/index.js";
import { BusinessCalendarAssignmentResolver } from "../../src/modules/integrations/index.js";

const resolverFor = (profile = DEVELOPMENT_BUSINESS) => new BusinessCalendarAssignmentResolver(
  new BusinessDirectoryService(new InMemoryBusinessRepository([profile])),
);

describe("BusinessCalendarAssignmentResolver", () => {
  it("resolves a professional calendar with trusted location timezone", async () => {
    const profile = structuredClone(DEVELOPMENT_BUSINESS);
    profile.locations[0]!.defaultCalendarId = "location@example.com";
    profile.locations[0]!.professionals[0]!.calendarId = "professional@example.com";
    await expect(resolverFor(profile).resolve({
      tenantId: profile.tenantId, locationId: "default", employeeId: "employee-1",
    })).resolves.toEqual({
      ok: true,
      value: { calendarId: "professional@example.com", timezone: "America/Merida", source: "professional" },
    });
  });

  it("uses the location calendar when a professional has no override", async () => {
    const profile = structuredClone(DEVELOPMENT_BUSINESS);
    profile.locations[0]!.defaultCalendarId = "location@example.com";
    await expect(resolverFor(profile).resolve({
      tenantId: profile.tenantId, locationId: "default", employeeId: "employee-1",
    })).resolves.toMatchObject({ ok: true, value: { calendarId: "location@example.com", source: "location" } });
  });

  it("fails closed for an unknown assignment or missing calendar", async () => {
    await expect(resolverFor().resolve({
      tenantId: DEVELOPMENT_BUSINESS.tenantId, locationId: "default", employeeId: "employee-1",
    })).resolves.toEqual({ ok: false, error: { code: "CALENDAR_NOT_CONFIGURED" } });
    await expect(resolverFor().resolve({
      tenantId: DEVELOPMENT_BUSINESS.tenantId, locationId: "default", employeeId: "unknown",
    })).resolves.toEqual({ ok: false, error: { code: "CALENDAR_NOT_CONFIGURED" } });
  });
});
