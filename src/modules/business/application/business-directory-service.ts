import { failure, success } from "../../../shared/domain/result.js";
import type { TenantId } from "../../../shared/types/identifiers.js";
import {
  normalizePhoneNumber,
  validateBusinessProfile,
  withDefaultTimezone,
} from "../domain/validate-business-profile.js";
import type {
  BusinessDirectory,
  BusinessLookupError,
  BusinessProfile,
} from "./contracts.js";
import type { BusinessRepository } from "../ports/business-repository.js";

export class BusinessDirectoryService implements BusinessDirectory {
  constructor(private readonly repository: BusinessRepository) {}

  async getBusinessByCalledNumber(phoneNumber: string) {
    const calledNumber = normalizePhoneNumber(phoneNumber);
    if (!calledNumber) return failure<BusinessLookupError>({ code: "INVALID_CALLED_NUMBER" });

    return this.toLookupResult(await this.repository.findByCalledNumber(calledNumber));
  }

  async getBusinessProfile(tenantId: TenantId) {
    return this.toLookupResult(await this.repository.findByTenantId(tenantId));
  }

  async updateTimezone(tenantId: TenantId, timezone: string) {
    const profile = await this.repository.findByTenantId(tenantId);
    if (!profile) return failure({ code: "BUSINESS_NOT_FOUND" as const });
    if (!profile.active) return failure({ code: "BUSINESS_INACTIVE" as const });

    const updated = { ...profile, timezone: timezone.trim() };
    const validationError = validateBusinessProfile(updated);
    if (validationError) {
      return failure({ code: "INVALID_TIMEZONE" as const, message: validationError.message });
    }
    await this.repository.save(updated);
    return success(updated);
  }

  private toLookupResult(profile: BusinessProfile | null) {
    if (!profile) return failure<BusinessLookupError>({ code: "BUSINESS_NOT_FOUND" });
    if (!profile.active) return failure<BusinessLookupError>({ code: "BUSINESS_INACTIVE" });

    const normalizedProfile = withDefaultTimezone(profile);
    const validationError = validateBusinessProfile(normalizedProfile);
    if (validationError) {
      return failure<BusinessLookupError>({
        code: "BUSINESS_CONFIGURATION_INVALID",
        message: validationError.message,
      });
    }

    return success(normalizedProfile);
  }
}
