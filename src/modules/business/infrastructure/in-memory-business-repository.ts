import { normalizePhoneNumber } from "../domain/validate-business-profile.js";
import type { VersionedBusinessProfile } from "../domain/upgrade-business-profile.js";
import type { BusinessRepository } from "../ports/business-repository.js";
import type { TenantId } from "../../../shared/types/identifiers.js";

export class InMemoryBusinessRepository implements BusinessRepository {
  private readonly byTenant = new Map<TenantId, VersionedBusinessProfile>();
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
    if (!this.byTenant.has(profile.tenantId)) {
      this.add(profile);
      return;
    }
    this.byTenant.set(profile.tenantId, structuredClone(profile));
    this.rebuildCalledNumbers();
  }

  private add(profile: VersionedBusinessProfile): void {
    if (this.byTenant.has(profile.tenantId)) {
      throw new Error(`Duplicate business tenant: ${profile.tenantId}`);
    }
    this.byTenant.set(profile.tenantId, structuredClone(profile));
    this.rebuildCalledNumbers();
  }

  private rebuildCalledNumbers(): void {
    this.tenantByCalledNumber.clear();
    for (const profile of this.byTenant.values()) for (const number of calledNumbers(profile)) {
      const normalized = normalizePhoneNumber(number);
      if (!normalized) continue;
      if (this.tenantByCalledNumber.has(normalized)) {
        throw new Error(`Called number already belongs to another active tenant: ${normalized}`);
      }
      this.tenantByCalledNumber.set(normalized, profile.tenantId);
    }
  }
}

const calledNumbers = (profile: VersionedBusinessProfile): string[] =>
  profile.schemaVersion === 2
    ? profile.locations.filter(({ active }) => active).flatMap(({ calledNumbers }) => calledNumbers)
    : profile.calledNumbers;
