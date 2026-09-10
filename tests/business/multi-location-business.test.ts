import { describe, expect, it } from "vitest";
import {
  MULTI_LOCATION_BUSINESS_SCHEMA_VERSION,
  validateMultiLocationBusiness,
  type BusinessConfigurationV2,
} from "../../src/modules/business/index.js";

const profile: BusinessConfigurationV2 = {
  schemaVersion: MULTI_LOCATION_BUSINESS_SCHEMA_VERSION,
  region: "MX",
  tenantId: "tenant-one",
  businessId: "business-one",
  name: "Clínica Uno",
  active: true,
  services: [{
    id: "consultation", name: "Consulta", description: "Consulta inicial",
    durationMinutes: 30, bufferMinutes: 0, active: true,
  }],
  professionals: [{ id: "professional-one", displayName: "Dra. Uno", active: true }],
  locations: [{
    id: "location-centro",
    name: "Centro",
    active: true,
    address: { line1: "Av. Central 100", city: "Mérida", countryCode: "MX" },
    timezone: "America/Merida",
    locale: "es-MX",
    calledNumbers: ["+529991234567"],
    openingHours: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
    closures: [{
      id: "closure-1", startLocal: "2026-12-24T13:00", endLocal: "2026-12-26T09:00",
      administrativeReason: "Cierre anual",
    }],
    policies: {
      defaultServiceId: "consultation",
      slotIncrementMinutes: 15,
      minimumLeadTimeMinutes: 0,
      maximumBookingHorizonDays: 90,
      maximumResults: 20,
      minimumCancellationNoticeMinutes: 0,
      minimumRescheduleNoticeMinutes: 0,
      concurrentCapacity: 1,
    },
    services: [{ serviceId: "consultation", active: true, price: { amountMinor: 80000, currency: "MXN" } }],
    professionals: [{
      professionalId: "professional-one", active: true, serviceIds: ["consultation"], openingHours: [],
      calendarId: "professional-one@example.com",
    }],
    defaultCalendarId: "centro@example.com",
    transferDestination: { type: "PHONE_NUMBER", value: "+529991112233" },
  }],
};

describe("multi-location business model", () => {
  it("accepts tenant catalogs with location-specific assignments and policy", () => {
    expect(validateMultiLocationBusiness(profile)).toEqual([]);
  });

  it("rejects a called number assigned to multiple locations", () => {
    const second = structuredClone(profile.locations[0]!);
    second.id = "location-norte";
    second.name = "Norte";
    expect(validateMultiLocationBusiness({ ...profile, locations: [...profile.locations, second] }))
      .toContainEqual(expect.objectContaining({
        path: "locations.1.calledNumbers.0",
        message: expect.stringContaining("more than one location"),
      }));
  });

  it("rejects cross-catalog references and unsafe scheduling values", () => {
    const invalid = structuredClone(profile);
    invalid.locations[0]!.services[0]!.serviceId = "service-from-another-tenant";
    invalid.locations[0]!.professionals[0]!.professionalId = "professional-from-another-tenant";
    invalid.locations[0]!.policies.concurrentCapacity = 0;
    invalid.locations[0]!.timezone = "Not/A-Timezone";
    const errors = validateMultiLocationBusiness(invalid);
    expect(errors.map(({ path }) => path)).toEqual(expect.arrayContaining([
      "locations.0.services.0.serviceId",
      "locations.0.professionals.0.professionalId",
      "locations.0.policies.defaultServiceId",
      "locations.0.policies.concurrentCapacity",
      "locations.0.timezone",
    ]));
  });

  it("rejects active assignments to inactive catalog entries", () => {
    const invalid = structuredClone(profile);
    invalid.services[0]!.active = false;
    invalid.professionals[0]!.active = false;
    expect(validateMultiLocationBusiness(invalid)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "locations.0.services.0.active" }),
      expect.objectContaining({ path: "locations.0.professionals.0.active" }),
    ]));
  });

  it("accepts only non-negative minor units and ISO 4217 currencies", () => {
    const invalid = structuredClone(profile);
    invalid.locations[0]!.services[0]!.price = { amountMinor: -1, currency: "ZZZ" };
    expect(validateMultiLocationBusiness(invalid)).toContainEqual({
      path: "locations.0.services.0.price",
      message: "Amount must be non-negative integer minor units.",
    });
    invalid.locations[0]!.services[0]!.price = { amountMinor: 100, currency: "ZZZ" };
    expect(validateMultiLocationBusiness(invalid)).toContainEqual({
      path: "locations.0.services.0.price",
      message: "Currency must be an uppercase ISO 4217 code.",
    });
  });

  it("accepts only normalized phone numbers or numeric extensions for transfer", () => {
    const invalid = structuredClone(profile);
    invalid.locations[0]!.transferDestination = { type: "EXTENSION", value: "sip:attacker" };
    expect(validateMultiLocationBusiness(invalid)).toContainEqual({
      path: "locations.0.transferDestination", message: "Invalid phone number or extension.",
    });
    invalid.locations[0]!.transferDestination = { type: "PHONE_NUMBER", value: "+529991112233" };
    expect(validateMultiLocationBusiness(invalid)).toEqual([]);
  });
});
