import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiServer } from "../../src/api/index.js";
import { createDevelopmentApplication } from "../../src/app/index.js";

let server: FastifyInstance | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

describe("business timezone API", () => {
  it("persists a valid timezone and rejects invalid input", async () => {
    server = await createApiServer(createDevelopmentApplication());

    const updated = await server.inject({ method: "PUT", url: "/api/business/timezone", payload: { timezone: "America/Denver" } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ timezone: "America/Denver" });

    const current = await server.inject({ method: "GET", url: "/api/business" });
    expect(current.json()).toMatchObject({ timezone: "America/Denver" });

    const invalid = await server.inject({ method: "PUT", url: "/api/business/timezone", payload: { timezone: "Nope/Invalid" } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: "INVALID_TIMEZONE" } });
  });
});
