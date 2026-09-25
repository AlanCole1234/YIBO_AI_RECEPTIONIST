import { changesBookedCalendarRoute, type CalendarRouteReference } from "../domain/protected-calendar-routes.js";
import { normalizePhoneNumber } from "../domain/validate-business-profile.js";
import { upgradeBusinessProfile, type VersionedBusinessProfile } from "../domain/upgrade-business-profile.js";
import type { BusinessConfigurationV2 } from "../domain/multi-location-business.js";
import type { BusinessRepository } from "../ports/business-repository.js";
import type { TenantId } from "../../../shared/types/identifiers.js";

export class InMemoryBusinessRepository implements BusinessRepository {
  private readonly byTenant = new Map<TenantId, BusinessConfigurationV2>();
  private readonly versionByTenant = new Map<TenantId, number>();
  private readonly tenantByCalledNumber = new Map<string, TenantId>();

  constructor(profiles: VersionedBusinessProfile[], private readonly references: (tenantId: TenantId) => readonly CalendarRouteReference[] = () => []) {
    for (const profile of profiles) this.add(profile);
  }

  async findByTenantId(tenantId: TenantId): Promise<VersionedBusinessProfile | null> {
    const value = this.byTenant.get(tenantId);
    return value ? structuredClone(value) : null;
  }

  async findConfigurationByTenantId(tenantId: TenantId) {
    const profile = this.byTenant.get(tenantId);
    const version = this.versionByTenant.get(tenantId);
    return profile && version !== undefined
      ? { profile: structuredClone(profile), version }
      : null;
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
    const expectedVersion = this.versionByTenant.get(canonical.tenantId)!;
    const saved = await this.saveIfVersion(canonical, expectedVersion);
    if (!saved.saved) throw new Error("Business configuration changed during save.");
  }

  async saveIfVersion(profile: VersionedBusinessProfile, expectedVersion: number) {
    const canonical = upgradeBusinessProfile(profile);
    const currentVersion = this.versionByTenant.get(canonical.tenantId);
    if (currentVersion === undefined || currentVersion !== expectedVersion) {
      return { saved: false as const, currentVersion: currentVersion ?? null };
    }
    if (changesBookedCalendarRoute(this.byTenant.get(canonical.tenantId)!, canonical, this.references(canonical.tenantId))) {
      return { saved: false as const, currentVersion, reason: "CALENDAR_ROUTE_IN_USE" as const };
    }
    const candidate = new Map(this.byTenant);
    candidate.set(canonical.tenantId, structuredClone(canonical));
    const numberIndex = calledNumberIndex(candidate.values());
    this.byTenant.set(canonical.tenantId, structuredClone(canonical));
    this.replaceCalledNumberIndex(numberIndex);
    const version = currentVersion + 1;
    this.versionByTenant.set(canonical.tenantId, version);
    return { saved: true as const, version };
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
    this.versionByTenant.set(canonical.tenantId, 1);
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
