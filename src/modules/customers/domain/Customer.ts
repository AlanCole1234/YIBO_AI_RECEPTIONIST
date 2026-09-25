import type { CustomerId, TenantId } from "../../../shared/types/identifiers.js";

export interface Customer {
  id: CustomerId;
  tenantId: TenantId;
  phone: string;
  name?: string;
  email?: string;
  preferredLanguage?: string;
  emailVerifiedAt?: string;
  emailOptIn?: boolean;
  source?: "AI_CALL" | "OFFICE" | "API" | "IMPORT" | "UNKNOWN";
  createdAt?: string;
  updatedAt?: string;
}
