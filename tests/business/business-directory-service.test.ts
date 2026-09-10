import { describe, expect, it } from "vitest";
import {
  BusinessDirectoryService,
  InMemoryBusinessRepository,
  upgradeBusinessProfile,
  type BusinessProfile,
} from "../../src/modules/business/index.js";

const profile: BusinessProfile = {
  region: "US",
  tenantId: "tenant-smileline",
  businessId: "business-smileline",
  name: "SmileLine Dental",
  timezone: "America/Denver",
  locale: "en-US",
  active: true,
  calledNumbers: ["+1 (303) 555-0123"],
  employees: [{ id: "dr-lee", displayName: "Dr. Lee", active: true }],
  services: [{ id: "cleaning", name: "Cleaning", durationMinutes: 45, bufferMinutes: 10, eligibleEmployeeIds: ["dr-lee"] }],
  openingHours: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
};

describe("BusinessDirectoryService", () => {
  it("resolves an active business by a normalized called number", async () => {
    const service = new BusinessDirectoryService(new InMemoryBusinessRepository([profile]));

    await expect(service.getBusinessByCalledNumber("+1 303-555-0123")).resolves.toEqual({
      ok: true, value: upgradeBusinessProfile(profile),
    });
  });

  it("rejects an inactive tenant before exposing its profile", async () => {
    const service = new BusinessDirectoryService(new InMemoryBusinessRepository([{ ...profile, active: false }]));

    await expect(service.getBusinessProfile(profile.tenantId)).resolves.toEqual({
      ok: false,
      error: { code: "BUSINESS_INACTIVE" },
    });
  });

  it("returns a typed error for invalid phone input", async () => {
    const service = new BusinessDirectoryService(new InMemoryBusinessRepository([profile]));

    await expect(service.getBusinessByCalledNumber("not a number")).resolves.toEqual({
      ok: false,
      error: { code: "INVALID_CALLED_NUMBER" },
    });
  });

  it("rejects a cross-tenant professional reference at the in-memory boundary", () => {
    const invalidProfile = {
      ...profile,
      services: [{ ...profile.services[0]!, eligibleEmployeeIds: ["not-in-this-tenant"] }],
    };
    expect(() => new InMemoryBusinessRepository([invalidProfile]))
      .toThrow("unknown professional not-in-this-tenant");
  });

  it("saves a valid IANA timezone and rejects an invalid one", async () => {
    const service = new BusinessDirectoryService(new InMemoryBusinessRepository([profile]));

    await expect(service.updateBusinessTimezone(profile.tenantId, "America/Denver")).resolves.toMatchObject({
      ok: true, value: { locations: [{ id: "default", timezone: "America/Denver" }] },
    });
    await expect(service.updateBusinessTimezone(profile.tenantId, "Not/A-Timezone")).resolves.toMatchObject({
      ok: false,
      error: { code: "BUSINESS_CONFIGURATION_INVALID" },
    });
  });

  it("resolves tenant and location exclusively from the called number", async () => {
    const multiLocation = upgradeBusinessProfile(profile);
    const north = structuredClone(multiLocation.locations[0]!);
    north.id = "north";
    north.name = "North";
    north.timezone = "America/Chicago";
    north.calledNumbers = ["+13125550123"];
    multiLocation.locations.push(north);
    const service = new BusinessDirectoryService(new InMemoryBusinessRepository([multiLocation]));

    await expect(service.resolveLocationByCalledNumber("+1 312 555 0123")).resolves.toMatchObject({
      ok: true,
      value: {
        tenantId: profile.tenantId,
        locationId: "north",
        location: { timezone: "America/Chicago" },
      },
    });
    await expect(service.getLocation(profile.tenantId, "missing")).resolves.toEqual({
      ok: false,
      error: { code: "LOCATION_NOT_FOUND" },
    });
  });
});
