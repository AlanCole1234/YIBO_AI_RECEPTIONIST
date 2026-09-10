import { failure, success } from "../../../shared/domain/result.js";
import type { TenantId } from "../../../shared/types/identifiers.js";
import type {
  LocationProfessionalAssignment,
  LocationSchedulingPolicy,
  LocationTransferDestination,
  ProfessionalDefinition,
  TenantServiceDefinition,
} from "../domain/multi-location-business.js";
import type { BusinessDirectory, BusinessLookupError } from "./contracts.js";

export type BusinessCatalogError = BusinessLookupError
  | { code: "SERVICE_ALREADY_EXISTS" }
  | { code: "SERVICE_NOT_FOUND" }
  | { code: "SERVICE_IN_USE" }
  | { code: "PROFESSIONAL_ALREADY_EXISTS" }
  | { code: "PROFESSIONAL_NOT_FOUND" }
  | { code: "PROFESSIONAL_INACTIVE" }
  | { code: "PROFESSIONAL_IN_USE" };

export interface ProfessionalUsageReader {
  hasProfessionalReferences(query: {
    tenantId: TenantId;
    professionalId: string;
    locationId?: string;
  }): Promise<boolean>;
}

export interface ServiceCatalogSnapshot {
  version: number;
  services: TenantServiceDefinition[];
}

export interface ServiceCatalogMutation {
  version: number;
  service: TenantServiceDefinition;
}

export interface ProfessionalCatalogSnapshot {
  version: number;
  professionals: ProfessionalDefinition[];
  assignments: Array<{ locationId: string; professionals: LocationProfessionalAssignment[] }>;
}

export interface LocationPolicySnapshot {
  version: number;
  locationId: string;
  policy: LocationSchedulingPolicy;
}

export interface LocationCalendarSnapshot {
  version: number;
  locationId: string;
  defaultCalendarId?: string;
  professionals: Array<{
    professionalId: string;
    displayName: string;
    calendarId?: string;
    effectiveCalendarId?: string;
    source: "professional" | "location" | "unconfigured";
  }>;
}

export interface LocationTransferSnapshot {
  version: number;
  locationId: string;
  destination?: LocationTransferDestination;
}

export class BusinessCatalogService {
  constructor(
    private readonly businesses: BusinessDirectory,
    private readonly professionalUsage: ProfessionalUsageReader = noProfessionalUsage,
  ) {}

  async listServices(tenantId: TenantId) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    return current.ok
      ? success<ServiceCatalogSnapshot>({
          version: current.value.version,
          services: structuredClone(current.value.configuration.services),
        })
      : failure<BusinessCatalogError>(current.error);
  }

  async createService(tenantId: TenantId, service: TenantServiceDefinition, expectedVersion: number) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    if (!current.ok) return failure<BusinessCatalogError>(current.error);
    if (current.value.configuration.services.some(({ id }) => id === service.id)) {
      return failure<BusinessCatalogError>({ code: "SERVICE_ALREADY_EXISTS" });
    }
    const updated = await this.businesses.updateBusinessConfiguration(tenantId, {
      ...current.value.configuration,
      services: [...current.value.configuration.services, structuredClone(service)],
    }, expectedVersion);
    return updated.ok
      ? success<ServiceCatalogMutation>({ version: updated.value.version, service: structuredClone(service) })
      : failure<BusinessCatalogError>(updated.error);
  }

  async updateService(
    tenantId: TenantId,
    serviceId: string,
    replacement: Omit<TenantServiceDefinition, "id">,
    expectedVersion: number,
  ) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    if (!current.ok) return failure<BusinessCatalogError>(current.error);
    const existing = current.value.configuration.services.find(({ id }) => id === serviceId);
    if (!existing) return failure<BusinessCatalogError>({ code: "SERVICE_NOT_FOUND" });
    if (!replacement.active && isServiceAssigned(current.value.configuration.locations, serviceId)) {
      return failure<BusinessCatalogError>({ code: "SERVICE_IN_USE" });
    }
    const service = { id: serviceId, ...structuredClone(replacement) };
    const updated = await this.businesses.updateBusinessConfiguration(tenantId, {
      ...current.value.configuration,
      services: current.value.configuration.services.map((candidate) =>
        candidate.id === serviceId ? service : candidate),
    }, expectedVersion);
    return updated.ok
      ? success<ServiceCatalogMutation>({ version: updated.value.version, service })
      : failure<BusinessCatalogError>(updated.error);
  }

  async deleteService(tenantId: TenantId, serviceId: string, expectedVersion: number) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    if (!current.ok) return failure<BusinessCatalogError>(current.error);
    const service = current.value.configuration.services.find(({ id }) => id === serviceId);
    if (!service) return failure<BusinessCatalogError>({ code: "SERVICE_NOT_FOUND" });
    if (isServiceAssigned(current.value.configuration.locations, serviceId)) {
      return failure<BusinessCatalogError>({ code: "SERVICE_IN_USE" });
    }
    const updated = await this.businesses.updateBusinessConfiguration(tenantId, {
      ...current.value.configuration,
      services: current.value.configuration.services.filter(({ id }) => id !== serviceId),
    }, expectedVersion);
    return updated.ok
      ? success({ version: updated.value.version, deletedServiceId: serviceId })
      : failure<BusinessCatalogError>(updated.error);
  }

  async listProfessionals(tenantId: TenantId) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    return current.ok
      ? success<ProfessionalCatalogSnapshot>({
          version: current.value.version,
          professionals: structuredClone(current.value.configuration.professionals),
          assignments: current.value.configuration.locations.map((location) => ({
            locationId: location.id,
            professionals: structuredClone(location.professionals),
          })),
        })
      : failure<BusinessCatalogError>(current.error);
  }

  async createProfessional(tenantId: TenantId, professional: ProfessionalDefinition, expectedVersion: number) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    if (!current.ok) return failure<BusinessCatalogError>(current.error);
    if (current.value.configuration.professionals.some(({ id }) => id === professional.id)) {
      return failure<BusinessCatalogError>({ code: "PROFESSIONAL_ALREADY_EXISTS" });
    }
    const updated = await this.businesses.updateBusinessConfiguration(tenantId, {
      ...current.value.configuration,
      professionals: [...current.value.configuration.professionals, structuredClone(professional)],
    }, expectedVersion);
    return updated.ok
      ? success({ version: updated.value.version, professional: structuredClone(professional) })
      : failure<BusinessCatalogError>(updated.error);
  }

  async updateProfessional(
    tenantId: TenantId,
    professionalId: string,
    replacement: Omit<ProfessionalDefinition, "id">,
    expectedVersion: number,
  ) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    if (!current.ok) return failure<BusinessCatalogError>(current.error);
    if (!current.value.configuration.professionals.some(({ id }) => id === professionalId)) {
      return failure<BusinessCatalogError>({ code: "PROFESSIONAL_NOT_FOUND" });
    }
    if (!replacement.active && (isProfessionalAssigned(current.value.configuration.locations, professionalId)
      || await this.professionalUsage.hasProfessionalReferences({ tenantId, professionalId }))) {
      return failure<BusinessCatalogError>({ code: "PROFESSIONAL_IN_USE" });
    }
    const professional = { id: professionalId, ...structuredClone(replacement) };
    const updated = await this.businesses.updateBusinessConfiguration(tenantId, {
      ...current.value.configuration,
      professionals: current.value.configuration.professionals.map((candidate) =>
        candidate.id === professionalId ? professional : candidate),
    }, expectedVersion);
    return updated.ok
      ? success({ version: updated.value.version, professional })
      : failure<BusinessCatalogError>(updated.error);
  }

  async deleteProfessional(tenantId: TenantId, professionalId: string, expectedVersion: number) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    if (!current.ok) return failure<BusinessCatalogError>(current.error);
    if (!current.value.configuration.professionals.some(({ id }) => id === professionalId)) {
      return failure<BusinessCatalogError>({ code: "PROFESSIONAL_NOT_FOUND" });
    }
    if (isProfessionalAssigned(current.value.configuration.locations, professionalId)
      || await this.professionalUsage.hasProfessionalReferences({ tenantId, professionalId })) {
      return failure<BusinessCatalogError>({ code: "PROFESSIONAL_IN_USE" });
    }
    const updated = await this.businesses.updateBusinessConfiguration(tenantId, {
      ...current.value.configuration,
      professionals: current.value.configuration.professionals.filter(({ id }) => id !== professionalId),
    }, expectedVersion);
    return updated.ok
      ? success({ version: updated.value.version, deletedProfessionalId: professionalId })
      : failure<BusinessCatalogError>(updated.error);
  }

  async setProfessionalAssignment(
    tenantId: TenantId,
    locationId: string,
    professionalId: string,
    assignment: Omit<LocationProfessionalAssignment, "professionalId">,
    expectedVersion: number,
  ) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    if (!current.ok) return failure<BusinessCatalogError>(current.error);
    const professional = current.value.configuration.professionals.find(({ id }) => id === professionalId);
    if (!professional) return failure<BusinessCatalogError>({ code: "PROFESSIONAL_NOT_FOUND" });
    if (!professional.active && assignment.active) return failure<BusinessCatalogError>({ code: "PROFESSIONAL_INACTIVE" });
    const location = current.value.configuration.locations.find(({ id }) => id === locationId);
    if (!location) return failure<BusinessCatalogError>({ code: "LOCATION_NOT_FOUND" });
    const existing = location.professionals.find(({ professionalId: id }) => id === professionalId);
    const removesExistingUse = existing && (!assignment.active
      || existing.serviceIds.some((serviceId) => !assignment.serviceIds.includes(serviceId)));
    if (removesExistingUse && await this.professionalUsage.hasProfessionalReferences({ tenantId, locationId, professionalId })) {
      return failure<BusinessCatalogError>({ code: "PROFESSIONAL_IN_USE" });
    }
    const replacement = { professionalId, ...structuredClone(assignment) };
    const updated = await this.businesses.updateBusinessConfiguration(tenantId, {
      ...current.value.configuration,
      locations: current.value.configuration.locations.map((candidate) => candidate.id === locationId
        ? {
            ...candidate,
            professionals: existing
              ? candidate.professionals.map((value) => value.professionalId === professionalId ? replacement : value)
              : [...candidate.professionals, replacement],
          }
        : candidate),
    }, expectedVersion);
    return updated.ok
      ? success({ version: updated.value.version, locationId, assignment: replacement })
      : failure<BusinessCatalogError>(updated.error);
  }

  async deleteProfessionalAssignment(
    tenantId: TenantId,
    locationId: string,
    professionalId: string,
    expectedVersion: number,
  ) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    if (!current.ok) return failure<BusinessCatalogError>(current.error);
    const location = current.value.configuration.locations.find(({ id }) => id === locationId);
    if (!location) return failure<BusinessCatalogError>({ code: "LOCATION_NOT_FOUND" });
    if (!location.professionals.some(({ professionalId: id }) => id === professionalId)) {
      return failure<BusinessCatalogError>({ code: "PROFESSIONAL_NOT_FOUND" });
    }
    if (await this.professionalUsage.hasProfessionalReferences({ tenantId, locationId, professionalId })) {
      return failure<BusinessCatalogError>({ code: "PROFESSIONAL_IN_USE" });
    }
    const updated = await this.businesses.updateBusinessConfiguration(tenantId, {
      ...current.value.configuration,
      locations: current.value.configuration.locations.map((candidate) => candidate.id === locationId
        ? { ...candidate, professionals: candidate.professionals.filter(({ professionalId: id }) => id !== professionalId) }
        : candidate),
    }, expectedVersion);
    return updated.ok
      ? success({ version: updated.value.version, locationId, deletedProfessionalId: professionalId })
      : failure<BusinessCatalogError>(updated.error);
  }

  async getLocationPolicy(tenantId: TenantId, locationId: string) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    if (!current.ok) return failure<BusinessCatalogError>(current.error);
    const location = current.value.configuration.locations.find(({ id }) => id === locationId);
    return location
      ? success<LocationPolicySnapshot>({
          version: current.value.version,
          locationId,
          policy: structuredClone(location.policies),
        })
      : failure<BusinessCatalogError>({ code: "LOCATION_NOT_FOUND" });
  }

  async updateLocationPolicy(
    tenantId: TenantId,
    locationId: string,
    policy: LocationSchedulingPolicy,
    expectedVersion: number,
  ) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    if (!current.ok) return failure<BusinessCatalogError>(current.error);
    if (!current.value.configuration.locations.some(({ id }) => id === locationId)) {
      return failure<BusinessCatalogError>({ code: "LOCATION_NOT_FOUND" });
    }
    const updated = await this.businesses.updateBusinessConfiguration(tenantId, {
      ...current.value.configuration,
      locations: current.value.configuration.locations.map((location) => location.id === locationId
        ? { ...location, policies: structuredClone(policy) }
        : location),
    }, expectedVersion);
    return updated.ok
      ? success<LocationPolicySnapshot>({ version: updated.value.version, locationId, policy: structuredClone(policy) })
      : failure<BusinessCatalogError>(updated.error);
  }

  async getLocationCalendars(tenantId: TenantId, locationId: string) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    if (!current.ok) return failure<BusinessCatalogError>(current.error);
    const location = current.value.configuration.locations.find(({ id }) => id === locationId);
    if (!location) return failure<BusinessCatalogError>({ code: "LOCATION_NOT_FOUND" });
    const names = new Map(current.value.configuration.professionals.map(({ id, displayName }) => [id, displayName]));
    return success<LocationCalendarSnapshot>({
      version: current.value.version,
      locationId,
      ...(location.defaultCalendarId ? { defaultCalendarId: location.defaultCalendarId } : {}),
      professionals: location.professionals.map((assignment) => {
        const effectiveCalendarId = assignment.calendarId ?? location.defaultCalendarId;
        return {
          professionalId: assignment.professionalId,
          displayName: names.get(assignment.professionalId) ?? assignment.professionalId,
          ...(assignment.calendarId ? { calendarId: assignment.calendarId } : {}),
          ...(effectiveCalendarId ? { effectiveCalendarId } : {}),
          source: assignment.calendarId ? "professional" : location.defaultCalendarId ? "location" : "unconfigured",
        };
      }),
    });
  }

  async updateLocationDefaultCalendar(
    tenantId: TenantId,
    locationId: string,
    calendarId: string | undefined,
    expectedVersion: number,
  ) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    if (!current.ok) return failure<BusinessCatalogError>(current.error);
    if (!current.value.configuration.locations.some(({ id }) => id === locationId)) {
      return failure<BusinessCatalogError>({ code: "LOCATION_NOT_FOUND" });
    }
    const updated = await this.businesses.updateBusinessConfiguration(tenantId, {
      ...current.value.configuration,
      locations: current.value.configuration.locations.map((location) => {
        if (location.id !== locationId) return location;
        const { defaultCalendarId: _removed, ...withoutCalendar } = location;
        return calendarId ? { ...withoutCalendar, defaultCalendarId: calendarId } : withoutCalendar;
      }),
    }, expectedVersion);
    if (!updated.ok) return failure<BusinessCatalogError>(updated.error);
    return this.getLocationCalendars(tenantId, locationId);
  }

  async updateProfessionalCalendar(
    tenantId: TenantId,
    locationId: string,
    professionalId: string,
    calendarId: string | undefined,
    expectedVersion: number,
  ) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    if (!current.ok) return failure<BusinessCatalogError>(current.error);
    const location = current.value.configuration.locations.find(({ id }) => id === locationId);
    if (!location) return failure<BusinessCatalogError>({ code: "LOCATION_NOT_FOUND" });
    if (!location.professionals.some(({ professionalId: id }) => id === professionalId)) {
      return failure<BusinessCatalogError>({ code: "PROFESSIONAL_NOT_FOUND" });
    }
    const updated = await this.businesses.updateBusinessConfiguration(tenantId, {
      ...current.value.configuration,
      locations: current.value.configuration.locations.map((candidate) => candidate.id === locationId
        ? {
            ...candidate,
            professionals: candidate.professionals.map((assignment) => {
              if (assignment.professionalId !== professionalId) return assignment;
              const { calendarId: _removed, ...withoutCalendar } = assignment;
              return calendarId ? { ...withoutCalendar, calendarId } : withoutCalendar;
            }),
          }
        : candidate),
    }, expectedVersion);
    if (!updated.ok) return failure<BusinessCatalogError>(updated.error);
    return this.getLocationCalendars(tenantId, locationId);
  }

  async getLocationTransferDestination(tenantId: TenantId, locationId: string) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    if (!current.ok) return failure<BusinessCatalogError>(current.error);
    const location = current.value.configuration.locations.find(({ id }) => id === locationId);
    return location
      ? success<LocationTransferSnapshot>({
          version: current.value.version,
          locationId,
          ...(location.transferDestination ? { destination: structuredClone(location.transferDestination) } : {}),
        })
      : failure<BusinessCatalogError>({ code: "LOCATION_NOT_FOUND" });
  }

  async updateLocationTransferDestination(
    tenantId: TenantId,
    locationId: string,
    destination: LocationTransferDestination | undefined,
    expectedVersion: number,
  ) {
    const current = await this.businesses.getBusinessConfiguration(tenantId);
    if (!current.ok) return failure<BusinessCatalogError>(current.error);
    if (!current.value.configuration.locations.some(({ id }) => id === locationId)) {
      return failure<BusinessCatalogError>({ code: "LOCATION_NOT_FOUND" });
    }
    const updated = await this.businesses.updateBusinessConfiguration(tenantId, {
      ...current.value.configuration,
      locations: current.value.configuration.locations.map((location) => {
        if (location.id !== locationId) return location;
        const { transferDestination: _removed, ...withoutDestination } = location;
        return destination
          ? { ...withoutDestination, transferDestination: structuredClone(destination) }
          : withoutDestination;
      }),
    }, expectedVersion);
    if (!updated.ok) return failure<BusinessCatalogError>(updated.error);
    return this.getLocationTransferDestination(tenantId, locationId);
  }
}

const isServiceAssigned = (
  locations: Array<{ services: Array<{ serviceId: string }>; professionals: Array<{ serviceIds: string[] }> }>,
  serviceId: string,
): boolean => locations.some((location) =>
  location.services.some((assignment) => assignment.serviceId === serviceId)
  || location.professionals.some((assignment) => assignment.serviceIds.includes(serviceId)));

const isProfessionalAssigned = (
  locations: Array<{ professionals: Array<{ professionalId: string }> }>,
  professionalId: string,
): boolean => locations.some((location) =>
  location.professionals.some((assignment) => assignment.professionalId === professionalId));

const noProfessionalUsage: ProfessionalUsageReader = {
  hasProfessionalReferences: async () => false,
};
