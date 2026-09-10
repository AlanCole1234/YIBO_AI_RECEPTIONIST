import { normalizePhoneNumber } from "../domain/validate-business-profile.js";
import { upgradeBusinessProfile, type VersionedBusinessProfile } from "../domain/upgrade-business-profile.js";
import type { BusinessConfigurationV2 } from "../domain/multi-location-business.js";
import type { BusinessRepository } from "../ports/business-repository.js";
import type { TenantId } from "../../../shared/types/identifiers.js";

export class InMemoryBusinessRepository implements BusinessRepository {
  private readonly byTenant = new Map<TenantId, BusinessConfigurationV2>();
  private readonly tenantByCalledNumber = new Map<string, TenantId>();

  constructor(profiles: VersionedBusinessProfile[]) {
    for (const profile of profiles) this.add(profile);
  }

  async findByTenantId(tenantId: TenantId): Promise<VersionedBusinessProfile | null> {
    const value = this.byTenant.get(tenantId);
    return value ? structuredClone(value) : null;
  }

  async findByCalledNumber(calledNumber: string): Promise<VersionedBusinessProfile | null> {
    const tenantId = this.tenantByCalledNumber.get(calledNumber);
    const value = tenantId ? this.byTenant.get(tenantId) : undefined;
    return value ? structuredClone(value) : null;
  }

  async save(profile: VersionedBusinessProfile): Promise<void> {
    const canonical = upgradeBusinessProfile(profile);
    if (!this.byTenant.has(profile.tenantId)) {
      this.add(canonical);
      return;
    }
    const candidate = new Map(this.byTenant);
    candidate.set(canonical.tenantId, structuredClone(canonical));
    const numberIndex = calledNumberIndex(candidate.values());
    this.byTenant.set(canonical.tenantId, structuredClone(canonical));
    this.replaceCalledNumberIndex(numberIndex);
  }

  private add(profile: VersionedBusinessProfile): void {
    const canonical = upgradeBusinessProfile(profile);
    if (this.byTenant.has(canonical.tenantId)) {
      throw new Error(`Duplicate business tenant: ${canonical.tenantId}`);
    }
    const candidate = new Map(this.byTenant);
    candidate.set(canonical.tenantId, structuredClone(canonical));
    const numberIndex = calledNumberIndex(candidate.values());
    this.byTenant.set(canonical.tenantId, structuredClone(canonical));
    this.replaceCalledNumberIndex(numberIndex);
  }

  private replaceCalledNumberIndex(index: Map<string, TenantId>): void {
    this.tenantByCalledNumber.clear();
    for (const [phone, tenantId] of index) this.tenantByCalledNumber.set(phone, tenantId);
  }
}

const calledNumberIndex = (profiles: Iterable<BusinessConfigurationV2>): Map<string, TenantId> => {
  const index = new Map<string, TenantId>();
  for (const profile of profiles) for (const number of profile.locations
    .filter(({ active }) => active).flatMap(({ calledNumbers }) => calledNumbers)) {
    const normalized = normalizePhoneNumber(number);
    if (!normalized) continue;
    if (index.has(normalized)) {
      throw new Error(`Called number already belongs to another active tenant: ${normalized}`);
    }
    index.set(normalized, profile.tenantId);
  }
  return index;
};
