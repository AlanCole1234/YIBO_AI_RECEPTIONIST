import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApplication } from "../../src/bootstrap/index.js";
import { createApiServer } from "../../src/api/index.js";
import { createAdminTestSession } from "../helpers/admin-session.js";
import type { GoogleOAuthService, GoogleCalendarAccessStatus } from "../../src/modules/integrations/index.js";
import { api } from "../../dashboard/src/services/api.js";
import { createCalendarEditor, calendarStatusLabel } from "../../dashboard/src/services/calendar-editor.js";

let server: FastifyInstance | undefined;
afterEach(async () => { vi.unstubAllGlobals(); await server?.close(); server = undefined; });
async function fixture(roles: Array<"tenant_admin" | "operator"> = ["tenant_admin"]) {
  const verify = vi.fn(async (_tenant: string, id: string): Promise<GoogleCalendarAccessStatus> => id.startsWith("denied") ? "forbidden" : "accessible");
  const app = buildApplication({ googleOAuth: { verifyCalendarAccess: verify } as unknown as GoogleOAuthService });
  server = await createApiServer(app);
  const session = await createAdminTestSession(app, server, roles);
  const requests: Array<{ url: string; method: string; body: unknown; version: string | null }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined, version: new Headers(init?.headers).get("if-match") });
    const response = await server!.inject({ method: method as "GET" | "PUT", url,
      headers: { ...(method === "GET" ? session.readHeaders : session.mutationHeaders), ...Object.fromEntries(new Headers(init?.headers).entries()) },
      ...(init?.body ? { payload: String(init.body) } : {}),
    });
    return new Response(response.body, { status: response.statusCode });
  });
  const editor = createCalendarEditor(); await editor.load();
  return { app, editor, verify, requests };
}

describe("UI-007 calendar administration through existing APIs", () => {
  it("saves a location default, overrides it, and restores fallback with shared versions", async () => {
    const { editor, requests, app } = await fixture();
    editor.edit(); editor.state.draft!.calendarId = " branch@example.com ";
    expect(await editor.save()).toBe(true);
    expect(editor.state.snapshot).toMatchObject({ version: 2, defaultCalendarId: "branch@example.com" });
    const id = editor.state.snapshot!.professionals[0]!.professionalId;
    editor.edit(id); editor.state.draft!.calendarId = "provider@example.com";
    expect(await editor.save()).toBe(true);
    expect(editor.state.snapshot!.professionals[0]).toMatchObject({ source: "professional", effectiveCalendarId: "provider@example.com" });
    editor.edit(id); editor.state.draft!.calendarId = "";
    expect(await editor.save()).toBe(true);
    expect(editor.state.snapshot!.professionals[0]).toMatchObject({ source: "location", effectiveCalendarId: "branch@example.com" });
    expect(requests.filter(r => r.method === "PUT").map(r => [r.version, r.body])).toEqual([
      ['"1"', { calendarId: "branch@example.com" }], ['"2"', { calendarId: "provider@example.com" }], ['"3"', { calendarId: null }],
    ]);
    expect(await app.adminAudit.listByTenant(app.tenantId)).toHaveLength(3);
  });

  it("clears a default, leaving professionals without overrides unconfigured", async () => {
    const { editor } = await fixture();
    editor.edit(); editor.state.draft!.calendarId = "branch@example.com"; await editor.save();
    editor.edit(); editor.state.draft!.calendarId = " ";
    expect(await editor.save()).toBe(true);
    expect(editor.state.snapshot!.defaultCalendarId).toBeUndefined();
    expect(editor.state.snapshot!.professionals[0]!.source).toBe("unconfigured");
  });

  it("refreshes verification by reading saved mappings and never creates calendar events", async () => {
    const { editor, verify, requests } = await fixture();
    editor.edit(); editor.state.draft!.calendarId = "branch@example.com"; await editor.save();
    expect(editor.state.snapshot!.defaultCalendarStatus).toBeUndefined();
    requests.length = 0;
    await editor.load();
    expect(editor.state.snapshot!.defaultCalendarStatus).toBe("accessible");
    expect(editor.state.snapshot!.professionals[0]!.effectiveCalendarStatus).toBe("accessible");
    expect(verify).toHaveBeenCalled();
    expect(requests.every(r => r.method === "GET")).toBe(true);
    verify.mockResolvedValue("unavailable");
    await editor.load();
    expect(editor.state.snapshot!.defaultCalendarStatus).toBe("unavailable");
  });

  it("retains the draft and stored mapping when access is denied", async () => {
    const { editor } = await fixture();
    const before = JSON.stringify(editor.state.snapshot);
    editor.edit(); editor.state.draft!.calendarId = "denied@example.com";
    expect(await editor.save()).toBe(false);
    expect(editor.state.error).toContain("could not be verified");
    expect(editor.state.draft!.calendarId).toBe("denied@example.com");
    expect(JSON.stringify(editor.state.snapshot)).toBe(before);
    expect(editor.state.conflict).toBe(false);
  });

  it("blocks a stale write, retains the draft and does not retry before explicit reload", async () => {
    const { editor, app, requests } = await fixture();
    const id = editor.state.snapshot!.locationId;
    await app.businessCatalog.updateLocationDefaultCalendar(app.tenantId, id, "newer@example.com", 1);
    editor.edit(); editor.state.draft!.calendarId = "stale@example.com";
    expect(await editor.save()).toBe(false);
    expect(editor.state.conflict).toBe(true);
    expect(editor.state.draft!.calendarId).toBe("stale@example.com");
    const count = requests.length;
    expect(await editor.save()).toBe(false); expect(requests).toHaveLength(count);
    await editor.load();
    expect(editor.state.draft).toBeUndefined();
    expect(editor.state.snapshot!.defaultCalendarId).toBe("newer@example.com");
  });

  it("changes only the selected location route, preserving catalogs, assignments and hours", async () => {
    const { editor, app } = await fixture();
    const result = await app.business.getBusinessConfiguration(app.tenantId);
    if (!result.ok) throw new Error("Missing fixture");
    const document = result.value;
    const second = structuredClone(document.configuration.locations[0]!);
    second.id = "south"; second.name = "South"; second.active = false; second.calledNumbers = [];
    document.configuration.locations.push(second);
    await app.business.updateBusinessConfiguration(app.tenantId, document.configuration, document.version);
    await editor.load("south");
    editor.edit(); editor.state.draft!.calendarId = "south@example.com";
    expect(await editor.save()).toBe(true);
    const stored = await app.business.getBusinessConfiguration(app.tenantId);
    if (!stored.ok) throw new Error("Missing fixture");
    const expected = structuredClone(document.configuration);
    expected.locations[1]!.defaultCalendarId = "south@example.com";
    expect(stored.value.configuration).toEqual(expected);
  });

  it("denies operators and rejects caller-supplied tenant selectors", async () => {
    const { editor } = await fixture(["operator"]);
    expect(editor.state.snapshot).toBeUndefined();
    await expect(api.locationCalendars("default")).rejects.toMatchObject({ status: 403 });
    await expect(api.updateLocationCalendar("default", "branch@example.com", 1)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects tenant selectors even for an administrator", async () => {
    await fixture();
    const response = await fetch("/api/admin/locations/default/calendar", { method: "PUT", headers: { "content-type": "application/json", "if-match": '"1"' }, body: JSON.stringify({ calendarId: "branch@example.com", tenantId: "other" }) });
    expect(response.status).toBe(400);
  });

  it("does not expose raw provider errors", async () => {
    const editor = createCalendarEditor({ ...api, businessConfiguration: async () => { throw new Error("secret-provider-token"); } });
    expect(await editor.load()).toBe(false);
    expect(editor.state.error).not.toContain("secret-provider-token");
  });

  it("keeps the previous snapshot and draft when reloading fails", async () => {
    await fixture();
    const read = vi.fn(api.locationCalendars);
    const editor = createCalendarEditor({ ...api, locationCalendars: read });
    await editor.load();
    editor.edit(); editor.state.draft!.calendarId = "draft@example.com";
    const before = JSON.stringify(editor.state.snapshot);
    read.mockRejectedValueOnce(new Error("provider detail"));
    expect(await editor.load("missing")).toBe(false);
    expect(JSON.stringify(editor.state.snapshot)).toBe(before);
    expect(editor.state.draft!.calendarId).toBe("draft@example.com");
    expect(editor.state.error).not.toContain("provider detail");
  });
});

describe("safe calendar verification labels", () => {
  it.each(["accessible", "unconfigured", "integration_not_configured", "disconnected", "forbidden", "not_found", "unavailable"])("labels %s", status => {
    expect(calendarStatusLabel(status)).not.toContain("Not checked");
  });
  it("never renders unknown provider details as a status", () => {
    expect(calendarStatusLabel("secret-provider-token")).toBe(calendarStatusLabel(undefined));
  });
});
