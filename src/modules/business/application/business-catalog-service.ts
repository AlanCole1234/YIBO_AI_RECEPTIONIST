import { failure, success } from "../../../shared/domain/result.js";
import type { TenantId } from "../../../shared/types/identifiers.js";
import type { TenantServiceDefinition } from "../domain/multi-location-business.js";
import type { BusinessDirectory, BusinessLookupError } from "./contracts.js";

export type BusinessCatalogError = BusinessLookupError
  | { code: "SERVICE_ALREADY_EXISTS" }
  | { code: "SERVICE_NOT_FOUND" }
  | { code: "SERVICE_IN_USE" };

export interface ServiceCatalogSnapshot {
  version: number;
  services: TenantServiceDefinition[];
}

export interface ServiceCatalogMutation {
  version: number;
  service: TenantServiceDefinition;
}

export class BusinessCatalogService {
  constructor(private readonly businesses: BusinessDirectory) {}

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
}

const isServiceAssigned = (
  locations: Array<{ services: Array<{ serviceId: string }>; professionals: Array<{ serviceIds: string[] }> }>,
  serviceId: string,
): boolean => locations.some((location) =>
  location.services.some((assignment) => assignment.serviceId === serviceId)
  || location.professionals.some((assignment) => assignment.serviceIds.includes(serviceId)));
