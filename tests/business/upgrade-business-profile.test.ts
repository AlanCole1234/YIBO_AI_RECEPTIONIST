import { describe, expect, it } from "vitest";
import { DEVELOPMENT_BUSINESS } from "../../src/app/development-fixtures.js";
import {
  MULTI_LOCATION_BUSINESS_SCHEMA_VERSION,
  upgradeBusinessProfile,
} from "../../src/modules/business/index.js";

describe("upgradeBusinessProfile", () => {
  it("migrates the historical profile to one default location without losing IDs", () => {
    const source = structuredClone(DEVELOPMENT_BUSINESS);
    const upgraded = upgradeBusinessProfile(source);

    expect(upgraded).toMatchObject({
      schemaVersion: MULTI_LOCATION_BUSINESS_SCHEMA_VERSION,
      tenantId: source.tenantId,
      businessId: source.businessId,
      services: source.services.map(({ id, name, durationMinutes, bufferMinutes }) => ({
        id, name, description: "", durationMinutes, bufferMinutes, active: true,
      })),
      professionals: source.employees.map(({ id, displayName, active }) => ({ id, displayName, active })),
      locations: [{
        id: "default",
        timezone: source.timezone,
        locale: source.locale,
        calledNumbers: source.calledNumbers,
        openingHours: source.openingHours,
        policies: {
          defaultServiceId: source.services[0]!.id,
          slotIncrementMinutes: 15,
          maximumResults: 20,
          concurrentCapacity: 1,
        },
      }],
    });
    expect(source).toEqual(DEVELOPMENT_BUSINESS);
  });

  it("preserves service eligibility as professional assignments", () => {
    const upgraded = upgradeBusinessProfile(DEVELOPMENT_BUSINESS);
    const defaultLocation = upgraded.locations[0]!;
    for (const professional of defaultLocation.professionals) {
      expect(professional.serviceIds).toEqual(DEVELOPMENT_BUSINESS.services
        .filter(({ eligibleEmployeeIds }) => eligibleEmployeeIds.includes(professional.professionalId))
        .map(({ id }) => id));
    }
  });

  it("is idempotent and returns defensive copies for v2 input", () => {
    const first = upgradeBusinessProfile(DEVELOPMENT_BUSINESS);
    const second = upgradeBusinessProfile(first);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    second.locations[0]!.name = "Changed clone";
    expect(first.locations[0]!.name).not.toBe("Changed clone");
  });
});
