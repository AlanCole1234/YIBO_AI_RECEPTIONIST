import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const template = Object.fromEntries(readFileSync("deploy/aws/lightsail/staging.env.example", "utf8")
  .split("\n").filter(line => line && !line.startsWith("#"))
  .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
const valid = { ...template, YIBO_ADMIN_SESSION_KEY: "synthetic-staging-session-key-for-tests-only",
  YIBO_PUBLIC_HOSTNAME: "staging.synthetic-yibo.net", YIBO_DASHBOARD_ORIGIN: "https://staging.synthetic-yibo.net" };
function check(changes: Record<string, string>) {
  return spawnSync(process.execPath, ["deploy/aws/lightsail/check-staging.mjs"], {
    env: { ...valid, ...changes }, encoding: "utf8", timeout: 5_000,
  });
}
function rejects(changes: Record<string, string>) {
  const result = check(changes);
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stderr).event).toBe("staging.preflight.failed");
}

describe("isolated Lightsail staging startup", () => {
  it("accepts reviewed synthetic configuration without touching a database", () => {
    const result = check({});
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ event: "staging.preflight.passed" });
  });
  it("rejects a real runtime or another tenant", () => {
    rejects({ YIBO_RUNTIME: "openai-realtime" });
    rejects({ YIBO_TENANT_ID: "real-business" });
  });
  it("rejects non-staging databases and locks", () => {
    rejects({ YIBO_DATABASE_US: "/var/lib/yibo/us.sqlite" });
    rejects({ YIBO_DATABASE_MX: "/var/lib/yibo/mx.sqlite" });
    rejects({ YIBO_INSTANCE_LOCK: "0" });
    rejects({ YIBO_INSTANCE_LOCK_PATH: "/tmp/staging.lock" });
  });
  it("rejects external listening or dotenv loading", () => {
    rejects({ HOST: "0.0.0.0" });
    rejects({ PORT: "4317" });
    rejects({ DOTENV_CONFIG_PATH: ".env" });
  });
  it("rejects provider and AWS credentials without printing their values", () => {
    for (const key of ["OPENAI_API_KEY", "GOOGLE_CLIENT_SECRET", "ASTERISK_ARI_PASSWORD",
      "TELNYX_API_KEY", "RESEND_API_KEY", "YIBO_TOKEN_ENCRYPTION_KEY", "AWS_ACCESS_KEY_ID"]) {
      const result = check({ [key]: "synthetic-sensitive-marker" });
      expect(result.status).toBe(1);
      expect(result.stderr).not.toContain("synthetic-sensitive-marker");
    }
  });
  it("rejects absent or short session keys without leaking them", () => {
    rejects({ YIBO_ADMIN_SESSION_KEY: "" });
    rejects({ YIBO_ADMIN_SESSION_KEY: "short-test-secret" });
    expect(check({ YIBO_ADMIN_SESSION_KEY: "short-test-secret" }).stderr).not.toContain("short-test-secret");
  });
  it("requires the same exact HTTPS hostname for Caddy and the API", () => {
    for (const origin of ["http://staging.synthetic-yibo.net", "https://other.synthetic-yibo.net",
      "https://staging.synthetic-yibo.net/path", "https://staging.synthetic-yibo.net:444"]) {
      rejects({ YIBO_DASHBOARD_ORIGIN: origin });
    }
  });
  it("accepts a public IPv4 origin without contacting it, but rejects private/reserved addresses", () => {
    // Parser-only fixture. This address is not ours and is never contacted.
    expect(check({ YIBO_PUBLIC_HOSTNAME: "8.8.4.4", YIBO_DASHBOARD_ORIGIN: "https://8.8.4.4" }).status).toBe(0);
    for (const host of ["0.0.0.0", "10.0.0.1", "100.64.0.1", "169.254.169.254", "172.16.0.1",
      "192.168.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1",
      "255.255.255.255", "[::1]", "001.2.3.4"]) {
      rejects({ YIBO_PUBLIC_HOSTNAME: host, YIBO_DASHBOARD_ORIGIN: `https://${host}` });
    }
  });
  it("rejects placeholder, local, malformed and unreviewed address forms", () => {
    for (const host of ["staging.yibo.invalid", "staging.example.com", "localhost", "127.0.0.1",
      "staging.yibo.test", "user@host.net", "host.net/path", "host.net:443"]) {
      rejects({ YIBO_PUBLIC_HOSTNAME: host, YIBO_DASHBOARD_ORIGIN: `https://${host}` });
    }
  });
  it("rejects recording and outbound dialing", () => {
    rejects({ YIBO_CALL_RECORDING: "on" });
    rejects({ YIBO_OUTBOUND_DIALING: "enabled" });
  });
});
