import type { Result } from "../../../shared/domain/result.js";
import type {
  BusinessId,
  EmployeeId,
  IANATimeZone,
  ServiceId,
  TenantId,
} from "../../../shared/types/identifiers.js";

export interface BusinessDirectory {
  getBusinessByCalledNumber(
    phoneNumber: string,
  ): Promise<Result<BusinessProfile, BusinessLookupError>>;

  getBusinessProfile(
    tenantId: TenantId,
  ): Promise<Result<BusinessProfile, BusinessLookupError>>;
}

export interface BusinessProfile {
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
  | { code: "BUSINESS_CONFIGURATION_INVALID"; message: string };
