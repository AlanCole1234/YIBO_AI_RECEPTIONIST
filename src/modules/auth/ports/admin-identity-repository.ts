import type { TenantId } from "../../../shared/types/identifiers.js";
import type { AdminRole } from "../application/contracts.js";

export interface AdminIdentity {
  subject: string;
  tenantId: TenantId;
  email: string;
  passwordHash: string;
  roles: AdminRole[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminIdentityRepository {
  findByEmail(tenantId: TenantId, normalizedEmail: string): Promise<AdminIdentity | null>;
  save(identity: AdminIdentity): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<boolean>;
}
