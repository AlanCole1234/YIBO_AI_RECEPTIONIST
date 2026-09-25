import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../src/bootstrap/index.js";
import type { AdminRole } from "../../src/modules/auth/index.js";

export interface AdminTestSession {
  cookie: string;
  origin: string;
  readHeaders: { cookie: string };
  mutationHeaders: { cookie: string; origin: string };
}

export async function createAdminTestSession(
  app: YiboApplication,
  server: FastifyInstance,
  roles: AdminRole[] = ["tenant_admin"],
): Promise<AdminTestSession> {
  const email = `${roles.join("-")}@yibo.test`;
  const password = "a-secure-test-password";
  await app.adminAuth.credentials.create({ tenantId: app.tenantId, email, password, roles });
  const login = await server.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: app.config.dashboardOrigin },
    payload: { email, password },
  });
  if (login.statusCode !== 200) throw new Error(`Admin test login failed: ${login.body}`);
  const cookieHeader = login.headers["set-cookie"];
  const cookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  if (!cookie) throw new Error("Admin test login did not return a session cookie");
  return {
    cookie,
    origin: app.config.dashboardOrigin,
    readHeaders: { cookie },
    mutationHeaders: { cookie, origin: app.config.dashboardOrigin },
  };
}
