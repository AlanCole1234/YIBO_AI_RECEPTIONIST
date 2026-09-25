import type { TenantId } from "../../../shared/types/identifiers.js";

export const ADMIN_ROLES = ["owner", "office_manager", "secretary", "read_only", "tenant_admin", "operator"] as const;
export type AdminRole = typeof ADMIN_ROLES[number];

export const isAdminRole = (value: unknown): value is AdminRole =>
  typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);

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

export const hasAdminRole = (principal: AdminPrincipal, required: AdminRole): boolean => {
  if (principal.roles.some((role) => role === "owner" || role === "tenant_admin")) return true;
  if (required === "tenant_admin") return principal.roles.includes("office_manager");
  if (required === "operator") return principal.roles.some((role) =>
    role === "office_manager" || role === "secretary" || role === "operator" || role === "read_only");
  return principal.roles.includes(required);
};
