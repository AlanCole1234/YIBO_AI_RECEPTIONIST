import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiServer } from "../../src/api/index.js";
import { buildApplication } from "../../src/bootstrap/index.js";
import { createAdminTestSession } from "../helpers/admin-session.js";

let server: FastifyInstance | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

describe("business services API", () => {
  it("offers validated CRUD with optimistic versions and administrative audit", async () => {
    const app = buildApplication();
    server = await createApiServer(app);
    const operator = await createAdminTestSession(app, server, ["operator"]);
    const forbidden = await server.inject({ method: "GET", url: "/api/admin/services", headers: operator.readHeaders });
    expect(forbidden.statusCode).toBe(403);

    const admin = await createAdminTestSession(app, server);
    const listed = await server.inject({ method: "GET", url: "/api/admin/services", headers: admin.readHeaders });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers.etag).toBe('"1"');

    const invalid = await server.inject({
      method: "POST", url: "/api/admin/services",
      headers: { ...admin.mutationHeaders, "if-match": '"1"' },
      payload: { id: "x", name: "", description: "", durationMinutes: 0, bufferMinutes: -1, active: true },
    });
    expect(invalid.statusCode).toBe(400);

    const created = await server.inject({
      method: "POST", url: "/api/admin/services",
      headers: { ...admin.mutationHeaders, "if-match": '"1"' },
      payload: { id: "whitening", name: "Blanqueamiento", description: "Cosmético", durationMinutes: 60, bufferMinutes: 10, active: true },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ version: 2, service: { id: "whitening" } });

    const updated = await server.inject({
      method: "PUT", url: "/api/admin/services/whitening",
      headers: { ...admin.mutationHeaders, "if-match": '"2"' },
      payload: { name: "Blanqueamiento premium", description: "Cosmético", durationMinutes: 75, bufferMinutes: 10, active: true },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ version: 3, service: { name: "Blanqueamiento premium" } });

    const removed = await server.inject({
      method: "DELETE", url: "/api/admin/services/whitening",
      headers: { ...admin.mutationHeaders, "if-match": '"3"' },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ version: 4, deletedServiceId: "whitening" });
    await expect(app.adminAudit.listByTenant(app.tenantId)).resolves.toHaveLength(3);
  });

  it("returns a conflict for assigned services and stale writers", async () => {
    const app = buildApplication();
    server = await createApiServer(app);
    const admin = await createAdminTestSession(app, server);
    const assigned = await server.inject({
      method: "DELETE", url: "/api/admin/services/consultation",
      headers: { ...admin.mutationHeaders, "if-match": '"1"' },
    });
    expect(assigned.statusCode).toBe(409);
    expect(assigned.json()).toEqual({ error: { code: "SERVICE_IN_USE" } });

    const created = await server.inject({
      method: "POST", url: "/api/admin/services",
      headers: { ...admin.mutationHeaders, "if-match": '"1"' },
      payload: { id: "new", name: "Nuevo", description: "", durationMinutes: 30, bufferMinutes: 0, active: true },
    });
    expect(created.statusCode).toBe(201);
    const stale = await server.inject({
      method: "POST", url: "/api/admin/services",
      headers: { ...admin.mutationHeaders, "if-match": '"1"' },
      payload: { id: "stale", name: "Viejo", description: "", durationMinutes: 30, bufferMinutes: 0, active: true },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: { code: "CONFIGURATION_VERSION_CONFLICT", currentVersion: 2 } });
  });
});
