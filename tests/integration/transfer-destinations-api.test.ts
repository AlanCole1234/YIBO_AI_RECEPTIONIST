import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiServer } from "../../src/api/index.js";
import { buildApplication } from "../../src/bootstrap/index.js";
import { createAdminTestSession } from "../helpers/admin-session.js";

let server: FastifyInstance | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

describe("transfer destination API", () => {
  it("stores a normalized location phone or extension and supports removal", async () => {
    const app = buildApplication();
    server = await createApiServer(app);
    const admin = await createAdminTestSession(app, server);
    const phone = await server.inject({
      method: "PUT", url: "/api/admin/locations/default/transfer-destination",
      headers: { ...admin.mutationHeaders, "if-match": '"1"' },
      payload: { destination: { type: "PHONE_NUMBER", value: "+52 (999) 111-2233" } },
    });
    expect(phone.statusCode).toBe(200);
    expect(phone.json()).toEqual({
      version: 2, locationId: "default", destination: { type: "PHONE_NUMBER", value: "+529991112233" },
    });
    const extension = await server.inject({
      method: "PUT", url: "/api/admin/locations/default/transfer-destination",
      headers: { ...admin.mutationHeaders, "if-match": '"2"' },
      payload: { destination: { type: "EXTENSION", value: " 204 " } },
    });
    expect(extension.json()).toMatchObject({ version: 3, destination: { type: "EXTENSION", value: "204" } });
    const removed = await server.inject({
      method: "PUT", url: "/api/admin/locations/default/transfer-destination",
      headers: { ...admin.mutationHeaders, "if-match": '"3"' }, payload: { destination: null },
    });
    expect(removed.json()).toEqual({ version: 4, locationId: "default" });
    await expect(app.adminAudit.listByTenant(app.tenantId)).resolves.toHaveLength(3);
  });

  it("rejects unsafe destinations and requires tenant-admin authentication", async () => {
    const app = buildApplication();
    server = await createApiServer(app);
    const admin = await createAdminTestSession(app, server);
    expect((await server.inject({
      method: "GET", url: "/api/admin/locations/default/transfer-destination",
    })).statusCode).toBe(401);
    const unsafe = await server.inject({
      method: "PUT", url: "/api/admin/locations/default/transfer-destination",
      headers: { ...admin.mutationHeaders, "if-match": '"1"' },
      payload: { destination: { type: "EXTENSION", value: "sip:attacker" } },
    });
    expect(unsafe.statusCode).toBe(400);
    expect(unsafe.json()).toEqual({ error: { code: "INVALID_TRANSFER_DESTINATION" } });
  });
});
