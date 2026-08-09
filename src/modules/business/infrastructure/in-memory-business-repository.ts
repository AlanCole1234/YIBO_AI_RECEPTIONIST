import { normalizePhoneNumber } from "../domain/validate-business-profile.js";
import type { BusinessProfile } from "../application/contracts.js";
import type { BusinessRepository } from "../ports/business-repository.js";
import type { TenantId } from "../../../shared/types/identifiers.js";

export class InMemoryBusinessRepository implements BusinessRepository {
  private readonly byTenant = new Map<TenantId, BusinessProfile>();
  private readonly tenantByCalledNumber = new Map<string, TenantId>();

  constructor(profiles: BusinessProfile[]) {
    for (const profile of profiles) this.add(profile);
  }

  async findByTenantId(tenantId: TenantId): Promise<BusinessProfile | null> {
    return this.byTenant.get(tenantId) ?? null;
  }

  async findByCalledNumber(calledNumber: string): Promise<BusinessProfile | null> {
    const tenantId = this.tenantByCalledNumber.get(calledNumber);
    return tenantId ? this.byTenant.get(tenantId) ?? null : null;
  }

  private add(profile: BusinessProfile): void {
    if (this.byTenant.has(profile.tenantId)) {
      throw new Error(`Duplicate business tenant: ${profile.tenantId}`);
    }
    for (const number of profile.calledNumbers) {
      const normalized = normalizePhoneNumber(number);
      if (!normalized) continue;
      if (this.tenantByCalledNumber.has(normalized)) {
        throw new Error(`Called number already belongs to another active tenant: ${normalized}`);
      }
      this.tenantByCalledNumber.set(normalized, profile.tenantId);
    }
    this.byTenant.set(profile.tenantId, profile);
  }
}
