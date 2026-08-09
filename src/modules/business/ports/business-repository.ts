import type { BusinessProfile } from "../application/contracts.js";
import type { TenantId } from "../../../shared/types/identifiers.js";

export interface BusinessRepository {
  findByTenantId(tenantId: TenantId): Promise<BusinessProfile | null>;
  findByCalledNumber(calledNumber: string): Promise<BusinessProfile | null>;
}
