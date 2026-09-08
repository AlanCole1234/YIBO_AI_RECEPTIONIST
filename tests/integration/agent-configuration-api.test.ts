import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiServer } from "../../src/api/index.js";
import { buildApplication } from "../../src/bootstrap/index.js";

let server: FastifyInstance | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

describe("agent configuration API", () => {
  it("reads the tenant configuration and applies updates to the shared agent service", async () => {
    const app = buildApplication();
    server = await createApiServer(app);

    const response = await server.inject({ method: "GET", url: "/api/configuration" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      current: { locale: "es-MX", conversation: { model: "gpt-realtime-2.1" } },
      recommended: { locale: "es-MX" },
      secrets: { apiKeyConfigured: false },
    });
    expect(response.json<{ availableTools: unknown[] }>().availableTools).toHaveLength(6);

    const current = response.json<{ current: Record<string, unknown> }>().current;
    const update = await server.inject({
      method: "PUT",
      url: "/api/configuration",
      payload: { ...current, voice: "cedar" },
    });

    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({
      configuration: { voice: "cedar" },
      appliesTo: "next-conversation",
    });
    expect(await app.agentConfiguration.get(app.tenantId)).toMatchObject({ voice: "cedar" });
  });

  it("rejects invalid configuration without changing the current value", async () => {
    const app = buildApplication();
    server = await createApiServer(app);
    const before = await app.agentConfiguration.get(app.tenantId);

    const response = await server.inject({
      method: "PUT",
      url: "/api/configuration",
      payload: { ...before, instructions: "" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_AGENT_CONFIGURATION" } });
    expect(await app.agentConfiguration.get(app.tenantId)).toEqual(before);
  });
});
