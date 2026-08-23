import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiServer } from "../../src/api/index.js";
import { createDevelopmentApplication } from "../../src/app/index.js";

let server: FastifyInstance | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

describe("telephony API ingress", () => {
  it("accepts an authenticated provider-neutral event and dispatches it", async () => {
    const app = createDevelopmentApplication({ telephonyWebhookSecret: "telephony-secret" });
    const received = vi.fn(async () => undefined);
    app.telephony.onEvent(received);
    server = await createApiServer(app);

    const response = await server.inject({
      method: "POST",
      url: "/api/integrations/telephony/events",
      headers: { "x-yibo-telephony-key": "telephony-secret" },
      payload: { type: "INCOMING_CALL", callId: "call-1", from: "+15125550123", to: "+529991000000", occurredAt: "2026-08-24T16:00:00.000Z" },
    });

    expect(response.statusCode).toBe(202);
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ type: "INCOMING_CALL", callId: "call-1" }));
  });

  it("does not expose an ingress that has not been configured", async () => {
    server = await createApiServer(createDevelopmentApplication());
    const response = await server.inject({ method: "POST", url: "/api/integrations/telephony/events", payload: {} });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "NOT_CONFIGURED" } });
  });
});
