import type { BusinessProfile } from "../application/contracts.js";
import {
  MULTI_LOCATION_BUSINESS_SCHEMA_VERSION,
  validateMultiLocationBusiness,
  type BusinessConfigurationV2,
} from "./multi-location-business.js";

export type VersionedBusinessProfile = BusinessProfile | BusinessConfigurationV2;

export const isBusinessConfigurationV2 = (
  profile: VersionedBusinessProfile,
): profile is BusinessConfigurationV2 => profile.schemaVersion === MULTI_LOCATION_BUSINESS_SCHEMA_VERSION;

export const upgradeBusinessProfile = (
  input: VersionedBusinessProfile,
): BusinessConfigurationV2 => {
  if (isBusinessConfigurationV2(input)) {
    const cloned = normalizeLegacyV2Prices(structuredClone(input));
    assertValid(cloned);
    return cloned;
  }

  const defaultServiceId = input.services[0]?.id;
  if (!defaultServiceId) throw new Error("Cannot upgrade a business without at least one service.");
  const servicesByProfessional = new Map(input.employees.map(({ id }) => [id, [] as string[]]));
  for (const service of input.services) {
    for (const professionalId of service.eligibleEmployeeIds) {
      const assignedServices = servicesByProfessional.get(professionalId);
      if (!assignedServices) {
        throw new Error(`Cannot upgrade service ${service.id}: unknown professional ${professionalId}.`);
      }
      assignedServices.push(service.id);
    }
  }
  const upgraded: BusinessConfigurationV2 = {
    schemaVersion: MULTI_LOCATION_BUSINESS_SCHEMA_VERSION,
    region: input.region,
    tenantId: input.tenantId,
    businessId: input.businessId,
    name: input.name,
    active: input.active,
    services: input.services.map((service) => ({
      id: service.id,
      name: service.name,
      description: "",
      durationMinutes: service.durationMinutes,
      bufferMinutes: service.bufferMinutes,
      active: true,
    })),
    professionals: input.employees.map((employee) => ({
      id: employee.id,
      displayName: employee.displayName,
      active: employee.active,
    })),
    locations: [{
      id: "default",
      name: input.name,
      // Business activity gates routing globally. Keeping the migrated location
      // active preserves its DID assignment when an inactive tenant is later
      // reactivated, without making the inactive business routable.
      active: input.calledNumbers.length > 0,
      address: {
        line1: "Pending configuration",
        city: "Pending configuration",
        countryCode: input.region === "MX" ? "MX" : "US",
      },
      timezone: input.timezone,
      locale: input.locale,
      calledNumbers: [...input.calledNumbers],
      openingHours: structuredClone(input.openingHours),
      closures: [],
      policies: {
        defaultServiceId,
        slotIncrementMinutes: 15,
        minimumLeadTimeMinutes: 0,
        maximumBookingHorizonDays: 365,
        maximumResults: 20,
        minimumCancellationNoticeMinutes: 0,
        minimumRescheduleNoticeMinutes: 0,
        concurrentCapacity: 1,
      },
      services: input.services.map((service) => ({
        serviceId: service.id,
        active: true,
        price: {
          amountMinor: 0,
          currency: input.region === "MX" ? "MXN" : "USD",
        },
      })),
      professionals: input.employees.map((employee) => ({
        professionalId: employee.id,
        active: employee.active,
        serviceIds: [...(servicesByProfessional.get(employee.id) ?? [])],
        openingHours: [],
      })),
    }],
  };
  assertValid(upgraded);
  return upgraded;
};

const normalizeLegacyV2Prices = (profile: BusinessConfigurationV2): BusinessConfigurationV2 => ({
  ...profile,
  locations: profile.locations.map((location) => ({
    ...location,
    services: location.services.map((assignment) => {
      const legacy = assignment as typeof assignment & { priceAmountMinor?: number; priceCurrency?: string };
      if (assignment.price) return assignment;
      return {
        serviceId: assignment.serviceId,
        active: assignment.active,
        price: {
          amountMinor: legacy.priceAmountMinor ?? 0,
          currency: legacy.priceCurrency ?? (profile.region === "MX" ? "MXN" : "USD"),
        },
      };
    }),
  })),
});

const assertValid = (profile: BusinessConfigurationV2): void => {
  const errors = validateMultiLocationBusiness(profile);
  if (errors.length > 0) {
    throw new Error(`Invalid business profile v${profile.schemaVersion}: ${errors[0]!.path} ${errors[0]!.message}`);
  }
};
