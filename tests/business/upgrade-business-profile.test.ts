import { describe, expect, it } from "vitest";
import { DEVELOPMENT_BUSINESS } from "../../src/app/development-fixtures.js";
import {
  MULTI_LOCATION_BUSINESS_SCHEMA_VERSION,
  InMemoryBusinessRepository,
  upgradeBusinessProfile,
  type LegacyBusinessProfileV1,
} from "../../src/modules/business/index.js";

const legacySource: LegacyBusinessProfileV1 = {
  schemaVersion: 1,
  region: "MX",
  tenantId: "tenant-legacy",
  businessId: "business-legacy",
  name: "Legacy Clinic",
  timezone: "America/Merida",
  locale: "es-MX",
  active: true,
  calledNumbers: ["+529991234567"],
  employees: [
    { id: "employee-1", displayName: "Dra. Ana", active: true },
    { id: "employee-2", displayName: "Dr. Carlos", active: true },
  ],
  services: [
    { id: "consultation", name: "Consulta", durationMinutes: 30, bufferMinutes: 0, eligibleEmployeeIds: ["employee-1", "employee-2"] },
    { id: "cleaning", name: "Limpieza", durationMinutes: 45, bufferMinutes: 0, eligibleEmployeeIds: ["employee-1"] },
  ],
  openingHours: [{ dayOfWeek: 1, startTime: "09:00", endTime: "18:00" }],
};

describe("upgradeBusinessProfile", () => {
  it("migrates the historical profile to one default location without losing IDs", () => {
    const source = structuredClone(legacySource);
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
    expect(source).toEqual(legacySource);
  });

  it("preserves service eligibility as professional assignments", () => {
    const upgraded = upgradeBusinessProfile(legacySource);
    const defaultLocation = upgraded.locations[0]!;
    for (const professional of defaultLocation.professionals) {
      expect(professional.serviceIds).toEqual(legacySource.services
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

  it("keeps the development fixtures in the canonical v2 shape", () => {
    expect(DEVELOPMENT_BUSINESS.schemaVersion).toBe(MULTI_LOCATION_BUSINESS_SCHEMA_VERSION);
    expect(upgradeBusinessProfile(DEVELOPMENT_BUSINESS)).toEqual(DEVELOPMENT_BUSINESS);
  });

  it("normalizes legacy input at the in-memory persistence boundary", async () => {
    const repository = new InMemoryBusinessRepository([legacySource]);
    await expect(repository.findByTenantId(legacySource.tenantId)).resolves.toMatchObject({
      schemaVersion: MULTI_LOCATION_BUSINESS_SCHEMA_VERSION,
      locations: [{ id: "default" }],
    });
  });
});
