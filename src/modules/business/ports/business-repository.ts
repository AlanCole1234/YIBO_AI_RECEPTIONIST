import type { VersionedBusinessProfile } from "../domain/upgrade-business-profile.js";
import type { TenantId } from "../../../shared/types/identifiers.js";

export interface BusinessRepository {
  findByTenantId(tenantId: TenantId): Promise<VersionedBusinessProfile | null>;
  findByCalledNumber(calledNumber: string): Promise<VersionedBusinessProfile | null>;
  save(profile: VersionedBusinessProfile): Promise<void>;
}
