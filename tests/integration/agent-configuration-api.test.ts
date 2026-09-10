import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiServer } from "../../src/api/index.js";
import { buildApplication } from "../../src/bootstrap/index.js";
import { AGENT_TOOL_DEFINITIONS } from "../../src/modules/agents/index.js";
import { createAdminTestSession } from "../helpers/admin-session.js";

let server: FastifyInstance | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

describe("agent configuration API", () => {
  it("publishes every non-developer tool with complete dashboard metadata", async () => {
    const app = buildApplication();
    server = await createApiServer(app);
    const session = await createAdminTestSession(app, server);

    const response = await server.inject({ method: "GET", url: "/api/configuration", headers: session.readHeaders });
    const body = response.json<{ availableTools: Array<Record<string, unknown>> }>();
    const expected = AGENT_TOOL_DEFINITIONS
      .filter(({ name }) => name !== "enable_developer_test_mode" && name !== "delete_test_appointments")
      .map(({ name }) => name);

    expect(body.availableTools.map(({ name }) => name)).toEqual(expected);
    expect(body.availableTools.map(({ name }) => name)).toContain("update_customer");
    for (const descriptor of body.availableTools) {
      expect(descriptor).toEqual(expect.objectContaining({
        name: expect.any(String),
        description: expect.any(String),
        title: expect.any(String),
        help: expect.any(String),
        route: expect.any(String),
        icon: expect.any(String),
        kind: expect.stringMatching(/^(consult|mutate|external)$/),
      }));
    }
  });

  it("reads the tenant configuration and applies updates to the shared agent service", async () => {
    const app = buildApplication();
    server = await createApiServer(app);
    const session = await createAdminTestSession(app, server);

    const response = await server.inject({ method: "GET", url: "/api/configuration", headers: session.readHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      current: { schemaVersion: 1, locale: "es-MX", conversation: { model: "gpt-realtime-2.1" } },
      recommended: { schemaVersion: 1, locale: "es-MX" },
      secrets: { apiKeyConfigured: false },
    });
    expect(response.json<{ availableTools: unknown[] }>().availableTools).toHaveLength(6);

    const current = response.json<{ current: Record<string, unknown> }>().current;
    const update = await server.inject({
      method: "PUT",
      url: "/api/configuration",
      headers: session.mutationHeaders,
      payload: { ...current, voice: "cedar" },
    });

    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({
      configuration: { voice: "cedar" },
      appliesTo: "next-conversation",
    });
    expect(await app.agentConfiguration.get(app.tenantId)).toMatchObject({ voice: "cedar" });
    await expect(app.adminAudit.listByTenant(app.tenantId)).resolves.toMatchObject([{
      entityType: "agent_configuration",
      action: "update",
      entityVersion: "1",
      diff: { voice: { before: "marin", after: "cedar" } },
    }]);
  });

  it("rejects invalid configuration without changing the current value", async () => {
    const app = buildApplication();
    server = await createApiServer(app);
    const session = await createAdminTestSession(app, server);
    const before = await app.agentConfiguration.get(app.tenantId);

    const response = await server.inject({
      method: "PUT",
      url: "/api/configuration",
      headers: session.mutationHeaders,
      payload: { ...before, instructions: "" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_AGENT_CONFIGURATION" } });
    expect(await app.agentConfiguration.get(app.tenantId)).toEqual(before);
  });
});
