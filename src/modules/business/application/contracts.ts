import type { Result } from "../../../shared/domain/result.js";
import type {
  BusinessId,
  EmployeeId,
  IANATimeZone,
  LocationId,
  RegionId,
  ServiceId,
  TenantId,
} from "../../../shared/types/identifiers.js";
import type { BusinessConfigurationV2, LocationDefinition } from "../domain/multi-location-business.js";

export interface BusinessDirectory {
  resolveLocationByCalledNumber(
    phoneNumber: string,
  ): Promise<Result<BusinessLocationContext, BusinessLookupError>>;

  getLocation(
    tenantId: TenantId,
    locationId: LocationId,
  ): Promise<Result<BusinessLocationContext, BusinessLookupError>>;

  getBusinessByCalledNumber(
    phoneNumber: string,
  ): Promise<Result<BusinessConfigurationV2, BusinessLookupError>>;

  getBusinessProfile(
    tenantId: TenantId,
  ): Promise<Result<BusinessConfigurationV2, BusinessLookupError>>;

  updateBusinessTimezone(
    tenantId: TenantId,
    timezone: IANATimeZone,
  ): Promise<Result<BusinessConfigurationV2, BusinessLookupError>>;
}

export interface BusinessProfile {
  /** Historical v1 shape. Absence of this field also means v1. */
  schemaVersion?: 1;
  region: RegionId;
  tenantId: TenantId;
  businessId: BusinessId;
  name: string;
  timezone: IANATimeZone;
  locale: string;
  active: boolean;
  calledNumbers: string[];
  services: ServiceDefinition[];
  employees: EmployeeDefinition[];
  openingHours: OpeningHoursRule[];
}

export interface BusinessLocationContext {
  tenantId: TenantId;
  locationId: LocationId;
  business: BusinessConfigurationV2;
  location: LocationDefinition;
}

export type LegacyBusinessProfileV1 = BusinessProfile;

export interface ServiceDefinition {
  id: ServiceId;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  eligibleEmployeeIds: EmployeeId[];
}

export interface EmployeeDefinition {
  id: EmployeeId;
  displayName: string;
  active: boolean;
}

export interface OpeningHoursRule {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  startTime: string;
  endTime: string;
}

export type BusinessLookupError =
  | { code: "INVALID_CALLED_NUMBER" }
  | { code: "BUSINESS_NOT_FOUND" }
  | { code: "BUSINESS_INACTIVE" }
  | { code: "LOCATION_NOT_FOUND" }
  | { code: "BUSINESS_CONFIGURATION_INVALID"; message: string };
