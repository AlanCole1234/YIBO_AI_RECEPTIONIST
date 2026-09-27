import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const baseEnvironment = (databasePath: string): NodeJS.ProcessEnv => ({
  ...process.env,
  YIBO_TENANT_ID: "tenant-yibo-demo",
  YIBO_REGION: "MX",
  YIBO_RUNTIME: "openai-realtime",
  OPENAI_API_KEY: "test-openai-key",
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_REDIRECT_URI: "https://app.example.test/api/integrations/google/callback",
  YIBO_TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  YIBO_ADMIN_SESSION_KEY: "abcdef0123456789abcdef0123456789",
  YIBO_DASHBOARD_ORIGIN: "https://app.example.test",
  RESEND_API_KEY: "test-resend-key",
  YIBO_EMAIL_FROM: "YIBO <noreply@example.test>",
  ASTERISK_ARI_URL: "http://10.0.0.10:8088/ari",
  ASTERISK_ARI_APPLICATION: "yibo",
  ASTERISK_ARI_USERNAME: "yibo",
  ASTERISK_ARI_PASSWORD: "secret",
  YIBO_ASTERISK_MEDIA_HOST: "10.0.0.20",
  YIBO_ASTERISK_MEDIA_PORT_START: "20000",
  YIBO_ASTERISK_MEDIA_PORT_END: "20100",
  YIBO_DATABASE_MX: databasePath,
  PORT: "3000",
});

function run(env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["scripts/release-preflight.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
}

describe("release preflight", () => {
  it("accepts a complete production-shaped environment", () => {
    const directory = mkdtempSync(join(tmpdir(), "yibo-release-preflight-"));
    const databasePath = join(directory, "yibo-mx.sqlite");
    writeFileSync(databasePath, "");
    const result = run(baseEnvironment(databasePath));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Release preflight passed");
  });

  it("rejects implicit tenant/region defaults and non-durable regional storage", () => {
    const environment = baseEnvironment("/definitely/missing/yibo.sqlite");
    delete environment.YIBO_TENANT_ID;
    const result = run(environment);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("YIBO_TENANT_ID is required");
    expect(result.stderr).toContain("YIBO_DATABASE_MX does not exist");
  });

  it("rejects invalid region, ARI URL and API port", () => {
    const directory = mkdtempSync(join(tmpdir(), "yibo-release-preflight-"));
    const databasePath = join(directory, "yibo-mx.sqlite");
    writeFileSync(databasePath, "");
    const environment = baseEnvironment(databasePath);
    environment.YIBO_REGION = "EU";
    environment.ASTERISK_ARI_URL = "not-a-url";
    environment.PORT = "70000";
    const result = run(environment);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("YIBO_REGION must be MX or US");
    expect(result.stderr).toContain("ASTERISK_ARI_URL must be a valid HTTP(S) URL");
    expect(result.stderr).toContain("PORT must be an integer between 1 and 65535");
  });
});
