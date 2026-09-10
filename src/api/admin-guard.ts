import type { FastifyReply, FastifyRequest } from "fastify";
import type { YiboApplication } from "../bootstrap/index.js";
import { hasAdminRole, type AdminPrincipal, type AdminRole } from "../modules/auth/index.js";
import { adminSessionToken } from "./admin-session-cookie.js";

const principals = new WeakMap<FastifyRequest, AdminPrincipal>();

export const createAdminGuard = (app: YiboApplication, requiredRole: AdminRole) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = adminSessionToken(request);
    if (!token) {
      await reply.code(401).send({ error: { code: "AUTHENTICATION_REQUIRED" } });
      return;
    }
    const verified = await app.adminAuth.sessions.verify(token, new Date());
    if (!verified.ok) {
      await reply.code(401).send({ error: { code: verified.code } });
      return;
    }
    if (verified.principal.tenantId !== app.tenantId) {
      await reply.code(403).send({ error: { code: "TENANT_ACCESS_DENIED" } });
      return;
    }
    if (!hasAdminRole(verified.principal, requiredRole)) {
      await reply.code(403).send({ error: { code: "ROLE_REQUIRED" } });
      return;
    }
    if (isMutation(request.method) && request.headers.origin !== app.config.dashboardOrigin) {
      await reply.code(403).send({ error: { code: "ORIGIN_NOT_ALLOWED" } });
      return;
    }
    if (containsTenantSelector(request.body) || containsTenantSelector(request.query)) {
      await reply.code(400).send({ error: { code: "UNTRUSTED_TENANT_SELECTOR" } });
      return;
    }
    principals.set(request, verified.principal);
  };

export const adminPrincipalFor = (request: FastifyRequest): AdminPrincipal => {
  const principal = principals.get(request);
  if (!principal) throw new Error("Admin guard did not establish a principal");
  return principal;
};

export const isAllowedLoginOrigin = (request: FastifyRequest, app: YiboApplication): boolean =>
  request.headers.origin === app.config.dashboardOrigin;

const isMutation = (method: string): boolean => !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

const containsTenantSelector = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsTenantSelector);
  return Object.entries(value).some(([key, child]) =>
    ["tenantId", "tenant_id", "regionId", "region_id"].includes(key) || containsTenantSelector(child));
};
