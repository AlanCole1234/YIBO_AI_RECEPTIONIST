import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type DashboardEnvironment } from "../../deploy/cloudflare/worker.js";
import { createApiServer } from "../../src/api/index.js";
import { buildApplication } from "../../src/bootstrap/index.js";
import type { EditableBusinessConfiguration } from "../../src/modules/business/index.js";

const publicOrigin = "https://dashboard.yibo.example";
const backendOrigin = "https://origin.yibo.example";
const assetFetch = vi.fn(async () => new Response("dashboard assets"));
const upstreamFetch = vi.fn<typeof fetch>();
const env: DashboardEnvironment = { ASSETS: { fetch: assetFetch }, API_ORIGIN: backendOrigin };
let server: FastifyInstance | undefined;

beforeEach(() => {
  assetFetch.mockClear();
  upstreamFetch.mockReset();
  vi.stubGlobal("fetch", upstreamFetch);
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function request(path: string, init?: RequestInit): Request {
  return new Request(`${publicOrigin}${path}`, init);
}

describe("Cloudflare deployment proxy", () => {
  it.each(["/", "/appointments", "/assets/app.js", "/api-other"])("serves %s as an asset without an API origin", async path => {
    const incoming = request(path);
    const response = await worker.fetch(incoming, { ASSETS: env.ASSETS });
    expect(await response.text()).toBe("dashboard assets");
    expect(assetFetch).toHaveBeenCalledWith(incoming);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each(["/api", "/api/auth/me"])("never returns the SPA for an unconfigured %s", async path => {
    const response = await worker.fetch(request(path), { ASSETS: env.ASSETS });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "API_PROXY_NOT_CONFIGURED" } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(assetFetch).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    "invalid", "http://origin.yibo.example", `${backendOrigin}/api`,
    "https://user:password@origin.yibo.example", `${backendOrigin}?token=test`,
    `${backendOrigin}#fragment`, publicOrigin,
  ])("fails closed for an unsafe origin configuration: %s", async API_ORIGIN => {
    expect((await worker.fetch(request("/api/business"), { ...env, API_ORIGIN })).status).toBe(503);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("preserves %s method, payload, query and application security headers", async method => {
    upstreamFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const payload = JSON.stringify({ locationId: "synthetic-location", startAt: "2026-10-01T09:00:00" });
    const result = await worker.fetch(request("/api/appointments/test?locationId=synthetic%20location", {
      method,
      headers: {
        "content-type": "application/json", origin: publicOrigin,
        cookie: "yibo_admin_session=synthetic", authorization: "Bearer synthetic",
        "if-match": '"3"', host: "untrusted.example",
      },
      body: payload,
    }), env);
    expect(result.status).toBe(204);
    const [forwarded, options] = upstreamFetch.mock.calls[0]!;
    expect(forwarded).toBeInstanceOf(Request);
    const outgoing = forwarded as Request;
    expect(outgoing.url).toBe(`${backendOrigin}/api/appointments/test?locationId=synthetic%20location`);
    expect(outgoing.method).toBe(method);
    expect(await outgoing.text()).toBe(payload);
    expect(outgoing.headers.get("origin")).toBe(publicOrigin);
    expect(outgoing.headers.get("cookie")).toBe("yibo_admin_session=synthetic");
    expect(outgoing.headers.get("authorization")).toBe("Bearer synthetic");
    expect(outgoing.headers.get("if-match")).toBe('"3"');
    expect(outgoing.headers.has("host")).toBe(false);
    expect(options).toEqual({ redirect: "manual", cache: "no-store" });
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("uses only the configured backend, regardless of request parameters or host headers", async () => {
    upstreamFetch.mockResolvedValue(new Response("{}"));
    await worker.fetch(request("/api//other.example/test?origin=https://other.example&tenantId=other", {
      headers: { "x-forwarded-host": "other.example" },
    }), env);
    const outgoing = upstreamFetch.mock.calls[0]![0] as Request;
    expect(new URL(outgoing.url).origin).toBe(backendOrigin);
    expect(new URL(outgoing.url).pathname).toBe("/api//other.example/test");
    expect(new URL(outgoing.url).searchParams.get("tenantId")).toBe("other");
  });

  it("preserves separate cookies and version-conflict responses, and disables API caching", async () => {
    const headers = new Headers({ etag: '"4"', "cache-control": "public, max-age=3600" });
    headers.append("set-cookie", "first=synthetic; Secure; HttpOnly; Path=/");
    headers.append("set-cookie", "second=synthetic; Secure; Path=/");
    upstreamFetch.mockResolvedValue(Response.json({ error: { code: "VERSION_CONFLICT" } }, { status: 409, headers }));
    const response = await worker.fetch(request("/api/appointments/test"), env);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "VERSION_CONFLICT" } });
    expect(response.headers.getSetCookie()).toEqual(headers.getSetCookie());
    expect(response.headers.get("etag")).toBe('"4"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cdn-cache-control")).toBe("no-store");
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBe("no-store");
  });

  it("passes redirects to the browser without following them with credentials", async () => {
    upstreamFetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://accounts.google.com/" } }));
    const response = await worker.fetch(request("/api/integrations/google/callback?state=synthetic"), env);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://accounts.google.com/");
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(upstreamFetch.mock.calls[0]![1]?.redirect).toBe("manual");
  });

  it("returns a safe error on origin failure without retrying an ambiguous write", async () => {
    upstreamFetch.mockRejectedValue(new Error("private origin details must not escape"));
    const response = await worker.fetch(request("/api/appointments", { method: "POST", body: "{}" }), env);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: "API_ORIGIN_UNAVAILABLE" } });
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { CF_ACCESS_CLIENT_ID: "synthetic-id" },
    { CF_ACCESS_CLIENT_SECRET: "synthetic-secret" },
  ])("rejects partially configured origin credentials", async partial => {
    expect((await worker.fetch(request("/api/business"), { ...env, ...partial })).status).toBe(503);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("replaces client-supplied Access headers only with the operator's origin credentials", async () => {
    upstreamFetch.mockImplementation(async () => new Response("{}"));
    const incoming = () => request("/api/business", { headers: {
      "cf-access-client-id": "untrusted", "cf-access-client-secret": "untrusted",
      "cf-access-jwt-assertion": "untrusted", cookie: "yibo_admin_session=synthetic",
    } });
    await worker.fetch(incoming(), { ...env, CF_ACCESS_CLIENT_ID: "synthetic-id", CF_ACCESS_CLIENT_SECRET: "synthetic-secret" });
    const outgoing = upstreamFetch.mock.calls[0]![0] as Request;
    expect(outgoing.headers.get("cf-access-client-id")).toBe("synthetic-id");
    expect(outgoing.headers.get("cf-access-client-secret")).toBe("synthetic-secret");
    expect(outgoing.headers.has("cf-access-jwt-assertion")).toBe(false);
    expect(outgoing.headers.get("cookie")).toBe("yibo_admin_session=synthetic");
    await worker.fetch(incoming(), env);
    const withoutAccess = upstreamFetch.mock.calls[1]![0] as Request;
    expect(withoutAccess.headers.has("cf-access-client-id")).toBe(false);
    expect(withoutAccess.headers.has("cf-access-client-secret")).toBe(false);
  });

  it("does not expose WebSocket services through the HTTP API", async () => {
    const response = await worker.fetch(request("/api/voice", { headers: { upgrade: "websocket" } }), env);
    expect(response.status).toBe(400);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});

describe("existing Fastify contracts through the Cloudflare proxy", () => {
  async function setup() {
    vi.stubEnv("NODE_ENV", "production");
    const app = buildApplication({ environment: { YIBO_DASHBOARD_ORIGIN: publicOrigin } });
    server = await createApiServer(app);
    upstreamFetch.mockImplementation(async input => {
      const forwarded = input as Request;
      const url = new URL(forwarded.url);
      const response = await server!.inject({
        method: forwarded.method as InjectOptions["method"],
        url: url.pathname + url.search,
        headers: Object.fromEntries(forwarded.headers.entries()),
        ...(forwarded.body ? { payload: Buffer.from(await forwarded.arrayBuffer()) } : {}),
      });
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
        else if (value !== undefined) headers.set(name, String(value));
      }
      return new Response(response.body || null, { status: response.statusCode, headers });
    });
    await app.adminAuth.credentials.create({
      tenantId: app.tenantId, email: "synthetic@yibo.example", password: "synthetic-test-password", roles: ["tenant_admin"],
    });
    const login = await worker.fetch(request("/api/auth/login", {
      method: "POST", headers: { origin: publicOrigin, "content-type": "application/json" },
      body: JSON.stringify({ email: "synthetic@yibo.example", password: "synthetic-test-password" }),
    }), env);
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    const cookie = setCookie.split(";")[0]!;
    return { app, cookie, headers: { cookie, origin: publicOrigin, "content-type": "application/json" } };
  }

  it("logs in, reads the session and logs out without weakening origin checks", async () => {
    const { cookie, headers } = await setup();
    expect((await worker.fetch(request("/api/auth/me", { headers: { cookie } }), env)).status).toBe(200);
    for (const origin of ["https://untrusted.example", undefined]) {
      const response = await worker.fetch(request("/api/auth/logout", {
        method: "POST", headers: { cookie, ...(origin ? { origin } : {}) },
      }), env);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: { code: "ORIGIN_NOT_ALLOWED" } });
    }
    const logout = await worker.fetch(request("/api/auth/logout", { method: "POST", headers, body: "{}" }), env);
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await worker.fetch(request("/api/auth/me", { headers: { cookie } }), env)).status).toBe(401);
  });

  it("preserves tenant isolation and operator/admin authorization", async () => {
    const { app, headers } = await setup();
    const selectedTenant = await worker.fetch(request("/api/auth/logout", {
      method: "POST", headers, body: JSON.stringify({ nested: { tenantId: "other-tenant" } }),
    }), env);
    expect(selectedTenant.status).toBe(400);
    expect(await selectedTenant.json()).toEqual({ error: { code: "UNTRUSTED_TENANT_SELECTOR" } });
    const now = new Date();
    for (const [tenantId, roles, expected] of [
      ["other-tenant", ["tenant_admin"], "TENANT_ACCESS_DENIED"],
      [app.tenantId, ["operator"], "ROLE_REQUIRED"],
    ] as const) {
      const token = await app.adminAuth.sessions.issue({
        subject: "synthetic-operator", tenantId, roles: [...roles], now, expiresAt: new Date(now.valueOf() + 60_000),
      });
      const response = await worker.fetch(request("/api/configuration", {
        headers: { cookie: `yibo_admin_session=${encodeURIComponent(token)}` },
      }), env);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: { code: expected } });
    }
    expect((await worker.fetch(request("/api/business"), env)).status).toBe(401);
  });

  it("keeps version checks and returns fresh persisted configuration after a write", async () => {
    const { headers } = await setup();
    const path = "/api/admin/business-configuration";
    const current = await worker.fetch(request(path, { headers }), env);
    const document = await current.json() as { version: number; configuration: EditableBusinessConfiguration };
    const configuration = { ...document.configuration, name: "Synthetic proxy acceptance" };
    const save = (ifMatch?: string) => worker.fetch(request(path, {
      method: "PUT", headers: { ...headers, ...(ifMatch ? { "if-match": ifMatch } : {}) },
      body: JSON.stringify({ configuration }),
    }), env);
    expect((await save()).status).toBe(428);
    const updated = await save(current.headers.get("etag")!);
    expect(updated.status).toBe(200);
    expect(updated.headers.get("etag")).toBe(`"${document.version + 1}"`);
    const stale = await save(current.headers.get("etag")!);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: { code: "CONFIGURATION_VERSION_CONFLICT", currentVersion: document.version + 1 } });
    const fresh = await worker.fetch(request(path, { headers }), env);
    expect(await fresh.json()).toMatchObject({ version: document.version + 1, configuration: { name: configuration.name } });
  });
});
