import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApplication } from "../../src/bootstrap/index.js";
import { createApiServer } from "../../src/api/index.js";
import { createAdminTestSession } from "../helpers/admin-session.js";
let server: FastifyInstance | undefined;
afterEach(async () => { await server?.close(); });
async function fixture() {
  const app = buildApplication(); server = await createApiServer(app);
  const admin = await createAdminTestSession(app, server);
  const read = () => server!.inject({ method: "GET", url: "/api/configuration", headers: admin.readHeaders });
  const document = (await read()).json();
  const save = (voice: string, revision = document.revision) => server!.inject({ method: "PUT", url: "/api/configuration",
    headers: { ...admin.mutationHeaders, "if-match": `"${revision}"` }, payload: { ...document.current, audio: { ...document.current.audio, voice } } });
  return { app, admin, document, read, save };
}
describe("UI-009 agent configuration compare-and-save", () => {
  it("rejects a stale editor and accepts an explicit reload/reapply with the latest revision", async () => {
    const { app, document, read, save } = await fixture();
    const first = await save("cedar"); expect(first.statusCode).toBe(200);
    expect(first.json().revision).not.toBe(document.revision);
    expect((await read()).json().revision).toBe(first.json().revision);
    const stale = await save("marin"); expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("CONFIGURATION_VERSION_CONFLICT");
    expect((await read()).json().current.audio.voice).toBe("cedar");
    expect((await save("marin", (await read()).json().revision)).statusCode).toBe(200);
    expect(await app.adminAudit.listByTenant(app.tenantId)).toHaveLength(2);
  });
  it("allows only one competing write for the same revision", async () => {
    const { save, document, admin } = await fixture();
    const second = structuredClone(document.current); second.identity.instructions += " New instructions.";
    const responses = await Promise.all([save("cedar"), server!.inject({ method: "PUT", url: "/api/configuration",
      headers: { ...admin.mutationHeaders, "if-match": `"${document.revision}"` }, payload: second })]);
    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
  });
  it("requires a valid conditional header; schemaVersion is not a write revision", async () => {
    const { admin, document } = await fixture();
    const absent = await server!.inject({ method: "PUT", url: "/api/configuration", headers: admin.mutationHeaders, payload: document.current });
    expect(absent.statusCode).toBe(428);
    const invalid = await server!.inject({ method: "PUT", url: "/api/configuration", headers: { ...admin.mutationHeaders, "if-match": '"4"' }, payload: document.current });
    expect(invalid.statusCode).toBe(400);
  });
});
