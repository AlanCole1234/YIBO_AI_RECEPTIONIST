import type { VersionedBusinessProfile } from "../domain/upgrade-business-profile.js";
import type { TenantId } from "../../../shared/types/identifiers.js";

export interface StoredBusinessConfiguration {
  profile: VersionedBusinessProfile;
  version: number;
}

export type SaveBusinessConfigurationResult =
  | { saved: true; version: number }
  | { saved: false; currentVersion: number | null; reason?: "CALENDAR_ROUTE_IN_USE" };

export interface BusinessRepository {
  findByTenantId(tenantId: TenantId): Promise<VersionedBusinessProfile | null>;
  findConfigurationByTenantId(tenantId: TenantId): Promise<StoredBusinessConfiguration | null>;
  findByCalledNumber(calledNumber: string): Promise<VersionedBusinessProfile | null>;
  save(profile: VersionedBusinessProfile): Promise<void>;
  saveIfVersion(
    profile: VersionedBusinessProfile,
    expectedVersion: number,
  ): Promise<SaveBusinessConfigurationResult>;
}
