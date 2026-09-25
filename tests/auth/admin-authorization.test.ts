import { describe, expect, it } from "vitest";
import { hasAdminRole, type AdminPrincipal } from "../../src/modules/auth/index.js";

const principal = (roles: AdminPrincipal["roles"]): AdminPrincipal => ({
  subject: "admin-1",
  tenantId: "tenant-a",
  roles,
  issuedAt: "2026-09-10T00:00:00.000Z",
  expiresAt: "2026-09-10T08:00:00.000Z",
});

describe("admin authorization contracts", () => {
  it("allows tenant admins to perform configuration and operation work", () => {
    expect(hasAdminRole(principal(["tenant_admin"]), "tenant_admin")).toBe(true);
    expect(hasAdminRole(principal(["tenant_admin"]), "operator")).toBe(true);
  });

  it("does not allow operators to administer a tenant", () => {
    expect(hasAdminRole(principal(["operator"]), "operator")).toBe(true);
    expect(hasAdminRole(principal(["operator"]), "tenant_admin")).toBe(false);
  });
});
