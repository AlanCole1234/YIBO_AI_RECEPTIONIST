import type { TenantId } from "../../../shared/types/identifiers.js";

export type AdminRole = "tenant_admin" | "operator";

export interface AdminPrincipal {
  subject: string;
  tenantId: TenantId;
  roles: AdminRole[];
  issuedAt: string;
  expiresAt: string;
}

export interface IssueAdminSessionCommand {
  subject: string;
  tenantId: TenantId;
  roles: AdminRole[];
  now: Date;
  expiresAt: Date;
}

export type AdminSessionVerification =
  | { ok: true; principal: AdminPrincipal }
  | { ok: false; code: "INVALID_SESSION" | "EXPIRED_SESSION" | "REVOKED_SESSION" };

export const hasAdminRole = (principal: AdminPrincipal, required: AdminRole): boolean =>
  principal.roles.includes("tenant_admin") || principal.roles.includes(required);
