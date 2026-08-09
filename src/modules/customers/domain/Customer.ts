import type { CustomerId, TenantId } from "../../../shared/types/index.js";

export interface Customer {
  id: CustomerId;
  tenantId: TenantId;
  phone: string;
  name?: string;
  email?: string;
}
