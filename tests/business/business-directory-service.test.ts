import { describe, expect, it } from "vitest";
import {
  BusinessDirectoryService,
  InMemoryBusinessRepository,
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
      ok: true,
      value: profile,
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

  it("prevents a service from referencing an employee in another tenant", async () => {
    const invalidProfile = {
      ...profile,
      services: [{ ...profile.services[0]!, eligibleEmployeeIds: ["not-in-this-tenant"] }],
    };
    const service = new BusinessDirectoryService(new InMemoryBusinessRepository([invalidProfile]));

    await expect(service.getBusinessProfile(profile.tenantId)).resolves.toMatchObject({
      ok: false,
      error: { code: "BUSINESS_CONFIGURATION_INVALID" },
    });
  });

  it("updates a valid IANA timezone and rejects invalid timezone identifiers", async () => {
    const service = new BusinessDirectoryService(new InMemoryBusinessRepository([profile]));

    await expect(service.updateTimezone(profile.tenantId, "America/New_York")).resolves.toMatchObject({
      ok: true, value: { timezone: "America/New_York" },
    });
    await expect(service.updateTimezone(profile.tenantId, "not/a-timezone")).resolves.toEqual({
      ok: false, error: { code: "INVALID_TIMEZONE", message: "Business timezone must be a valid IANA timezone." },
    });
    await expect(service.getBusinessProfile(profile.tenantId)).resolves.toMatchObject({
      ok: true, value: { timezone: "America/New_York" },
    });
  });

  it("uses a region-safe default for legacy business records without a timezone", async () => {
    const legacyProfile = { ...profile, timezone: undefined } as unknown as BusinessProfile;
    const service = new BusinessDirectoryService(new InMemoryBusinessRepository([legacyProfile]));

    await expect(service.getBusinessProfile(profile.tenantId)).resolves.toMatchObject({
      ok: true, value: { timezone: "America/Chicago" },
    });
  });
});
