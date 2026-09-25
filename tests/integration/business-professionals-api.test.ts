import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiServer } from "../../src/api/index.js";
import { buildApplication } from "../../src/bootstrap/index.js";
import { createAdminTestSession } from "../helpers/admin-session.js";

let server: FastifyInstance | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

describe("business professionals API", () => {
  it("manages the catalog and location assignments with one shared version", async () => {
    const app = buildApplication();
    server = await createApiServer(app);
    const admin = await createAdminTestSession(app, server);

    const created = await server.inject({
      method: "POST", url: "/api/admin/professionals",
      headers: { ...admin.mutationHeaders, "if-match": '"1"' },
      payload: { id: "employee-3", displayName: "Dra. Elena", active: true },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ version: 2, professional: { id: "employee-3" } });

    const assigned = await server.inject({
      method: "PUT", url: "/api/admin/locations/default/professionals/employee-3",
      headers: { ...admin.mutationHeaders, "if-match": '"2"' },
      payload: {
        active: true,
        serviceIds: ["consultation"],
        openingHours: [{ dayOfWeek: 1, startTime: "10:00", endTime: "16:00" }],
      },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toMatchObject({
      version: 3,
      locationId: "default",
      assignment: { professionalId: "employee-3", serviceIds: ["consultation"] },
    });

    const inUse = await server.inject({
      method: "DELETE", url: "/api/admin/professionals/employee-3",
      headers: { ...admin.mutationHeaders, "if-match": '"3"' },
    });
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json()).toEqual({ error: { code: "PROFESSIONAL_IN_USE" } });

    const unassigned = await server.inject({
      method: "DELETE", url: "/api/admin/locations/default/professionals/employee-3",
      headers: { ...admin.mutationHeaders, "if-match": '"3"' },
    });
    expect(unassigned.statusCode).toBe(200);
    expect(unassigned.json()).toMatchObject({ version: 4, deletedProfessionalId: "employee-3" });

    const removed = await server.inject({
      method: "DELETE", url: "/api/admin/professionals/employee-3",
      headers: { ...admin.mutationHeaders, "if-match": '"4"' },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ version: 5, deletedProfessionalId: "employee-3" });
    await expect(app.adminAudit.listByTenant(app.tenantId)).resolves.toHaveLength(4);
  });

  it("rejects malformed and impossible assignments", async () => {
    const app = buildApplication();
    server = await createApiServer(app);
    const admin = await createAdminTestSession(app, server);

    const malformed = await server.inject({
      method: "PUT", url: "/api/admin/locations/default/professionals/employee-1",
      headers: { ...admin.mutationHeaders, "if-match": '"1"' },
      payload: { active: true, serviceIds: ["consultation"], openingHours: [{ dayOfWeek: 8, startTime: "10:00", endTime: "09:00" }] },
    });
    expect(malformed.statusCode).toBe(400);

    const unavailableService = await server.inject({
      method: "PUT", url: "/api/admin/locations/default/professionals/employee-1",
      headers: { ...admin.mutationHeaders, "if-match": '"1"' },
      payload: { active: true, serviceIds: ["not-offered"], openingHours: [] },
    });
    expect(unavailableService.statusCode).toBe(422);
    expect(unavailableService.json<{ error: { code: string } }>().error.code).toBe("BUSINESS_CONFIGURATION_INVALID");
  });
});
