import { failure, success } from "../../../shared/domain/result.js";
import type { TenantId } from "../../../shared/types/identifiers.js";
import {
  normalizePhoneNumber,
  validateBusinessProfile,
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

  private toLookupResult(profile: BusinessProfile | null) {
    if (!profile) return failure<BusinessLookupError>({ code: "BUSINESS_NOT_FOUND" });
    if (!profile.active) return failure<BusinessLookupError>({ code: "BUSINESS_INACTIVE" });

    const validationError = validateBusinessProfile(profile);
    if (validationError) {
      return failure<BusinessLookupError>({
        code: "BUSINESS_CONFIGURATION_INVALID",
        message: validationError.message,
      });
    }

    return success(profile);
  }
}
