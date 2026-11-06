import assert from "node:assert/strict";
import { createApiServer } from "../../src/api/index.js";
import { buildConfiguredApplication } from "../../src/bootstrap/build-configured-application.js";
import { loadConfiguration } from "../../src/bootstrap/configuration.js";
import { createAdminTestSession } from "../helpers/admin-session.js";

const scenario = process.argv[2];
assert(["connected", "provider-rejected", "consent-denied", "config-override", "providers-disabled"].includes(scenario!));
const dashboardOrigin = "https://dashboard.example.test";
const environment = {
  YIBO_DATABASE_MX: ":memory:",
  YIBO_RUNTIME: "in-memory",
  YIBO_DASHBOARD_ORIGIN: dashboardOrigin,
  ...(scenario === "providers-disabled" ? {} : {
    GOOGLE_CLIENT_ID: "synthetic-client-id",
    GOOGLE_CLIENT_SECRET: "synthetic-client-secret",
    GOOGLE_REDIRECT_URI: `${dashboardOrigin}/api/integrations/google/callback`,
    YIBO_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  }),
};
let tokenRequests = 0;
// No real network requests, credentials, databases or provider grants.
globalThis.fetch = async (input, init) => {
  assert.equal(String(input), "https://oauth2.googleapis.com/token");
  assert.equal(init?.method, "POST");
  assert.equal(new URLSearchParams(String(init.body)).get("redirect_uri"), environment.GOOGLE_REDIRECT_URI);
  tokenRequests++;
  return scenario === "provider-rejected" ? new Response(null, { status: 400 })
    : new Response(JSON.stringify({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600 }));
};
const config = scenario === "config-override"
  ? loadConfiguration({ ...environment, YIBO_DASHBOARD_ORIGIN: "https://override.example.test" }) : undefined;
const app = await buildConfiguredApplication({ environment, ...(config ? { config } : {}) });
const server = await createApiServer(app);
try {
  const session = await createAdminTestSession(app, server);
  const url = `/api/integrations/google/connect?${new URLSearchParams({ returnTo: app.config.dashboardOrigin })}`;
  assert.equal((await server.inject({ method: "GET", url })).statusCode, 401);
  const connect = await server.inject({ method: "GET", url, headers: session.readHeaders });
  if (scenario === "providers-disabled") {
    assert.equal(app.googleOAuth, undefined);
    assert.equal(connect.statusCode, 409);
    assert.equal(app.providerReadiness.calendar, false);
    assert.equal(tokenRequests, 0);
  } else {
    assert.equal(connect.statusCode, 200);
    const state = new URL(connect.json<{ url: string }>().url).searchParams.get("state")!;
    const query = new URLSearchParams({ state,
      ...(scenario === "consent-denied" ? { error: "access_denied" } : { code: "synthetic-code" }) });
    const callback = await server.inject({ method: "GET", url: `/api/integrations/google/callback?${query}` });
    const success = scenario === "connected" || scenario === "config-override";
    assert.equal(callback.statusCode, 302);
    assert.equal(callback.headers.location, `${app.config.dashboardOrigin}/?calendar=${success ? "connected" : "failed"}`);
    assert.equal(tokenRequests, scenario === "consent-denied" ? 0 : 1);
    assert.equal(await app.googleOAuth!.accessToken(app.tenantId), success ? "synthetic-access" : null);
    assert.equal(await app.googleOAuth!.accessToken("different-tenant"), null);
    if (scenario === "config-override") {
      assert.equal(app.googleOAuth!.authorizationUrl(app.tenantId, dashboardOrigin), null);
    }
    const rejected = await server.inject({ method: "GET",
      url: `/api/integrations/google/connect?${new URLSearchParams({ returnTo: "https://untrusted.example.test" })}`,
      headers: session.readHeaders });
    assert.equal(rejected.statusCode, 409);
  }
  console.log(JSON.stringify({ scenario, verified: true }));
} finally {
  await server.close();
}
