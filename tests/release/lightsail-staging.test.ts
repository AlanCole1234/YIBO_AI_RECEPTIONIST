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

const googleTest = {
  YIBO_STAGING_PROVIDER: "google-calendar-test",
  YIBO_DATABASE_US: "/var/lib/yibo/staging-google-us.sqlite",
  GOOGLE_CLIENT_ID: "123456-synthetic.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "synthetic-sensitive-marker-not-a-real-secret",
  GOOGLE_REDIRECT_URI: "https://staging.synthetic-yibo.net/api/integrations/google/callback",
  GOOGLE_CALENDAR_ID: "synthetic-test-calendar@group.calendar.google.com",
  YIBO_TOKEN_ENCRYPTION_KEY: "1".repeat(64),
};

describe("prepared authenticated Voice Lab staging profile", () => {
  const voice = { ...googleTest, YIBO_STAGING_PROVIDER: "voice-lab-test", YIBO_RUNTIME: "openai-realtime",
    YIBO_HOSTED_VOICE_LAB: "1", OPENAI_API_KEY: "synthetic-voice-key-not-a-real-provider-key" };
  it("accepts only explicit voice activation while keeping the verified Google test database", () => {
    expect(check(voice).status).toBe(0);
    rejects({ ...voice, YIBO_DATABASE_US: "/var/lib/yibo/us.sqlite" });
    rejects({ ...voice, YIBO_DATABASE_US: "/var/lib/yibo/staging-us.sqlite" });
    rejects({ ...voice, YIBO_RUNTIME: "in-memory" });
    rejects({ ...voice, YIBO_HOSTED_VOICE_LAB: "0" });
    rejects({ ...voice, YIBO_LOCAL_DEVELOPER_TEST_MODE: "1" });
  });
  it("keeps existing profiles closed to OpenAI and hosted preview activation", () => {
    rejects({ YIBO_HOSTED_VOICE_LAB: "1" });
    rejects({ ...googleTest, YIBO_HOSTED_VOICE_LAB: "1" });
    rejects({ ...voice, YIBO_STAGING_PROVIDER: "google-calendar-test" });
    rejects({ ...voice, YIBO_STAGING_PROVIDER: "synthetic" });
  });
  it("requires private OpenAI credentials and never prints them", () => {
    for (const value of ["", "short", "invalid-key-with\nnewline"]) rejects({ ...voice, OPENAI_API_KEY: value });
    expect(check(voice).stdout).not.toContain(voice.OPENAI_API_KEY);
    const result = check({ ...voice, OPENAI_ADMIN_KEY: "synthetic-admin-key-must-remain-absent" });
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("synthetic-admin-key");
  });
  it("still forbids phone, mail, cloud credentials and an incomplete Google grant configuration", () => {
    for (const key of ["ASTERISK_ARI_PASSWORD", "TELNYX_API_KEY", "RESEND_API_KEY", "AWS_ACCESS_KEY_ID"]) {
      rejects({ ...voice, [key]: "synthetic-sensitive-marker" });
    }
    rejects({ ...voice, GOOGLE_CLIENT_SECRET: "" });
    rejects({ ...voice, GOOGLE_REDIRECT_URI: "https://elsewhere.example.test/api/integrations/google/callback" });
  });
});

describe("prepared Lightsail Google Calendar test profile", () => {
  it("accepts the explicit profile with a separate test DB and complete configuration", () => {
    const result = check(googleTest);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ event: "staging.preflight.passed" });
  });
  it("keeps synthetic mode as the default and rejects unknown profiles", () => {
    expect(check({ YIBO_STAGING_PROVIDER: "synthetic" }).status).toBe(0);
    for (const provider of ["", "google", "GOOGLE-CALENDAR-TEST", "production"]) {
      rejects({ YIBO_STAGING_PROVIDER: provider });
    }
    rejects({ ...googleTest, YIBO_STAGING_PROVIDER: "synthetic" });
  });
  it("requires a separate DB and the existing shared host lock", () => {
    for (const path of ["/var/lib/yibo/staging-us.sqlite", "/var/lib/yibo/us.sqlite", ":memory:"]) {
      rejects({ ...googleTest, YIBO_DATABASE_US: path });
    }
    rejects({ ...googleTest, YIBO_INSTANCE_LOCK_PATH: "/tmp/google-test.lock" });
    rejects({ YIBO_DATABASE_US: googleTest.YIBO_DATABASE_US });
  });
  it("requires every Google setting and does not print secret values", () => {
    for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI",
      "GOOGLE_CALENDAR_ID", "YIBO_TOKEN_ENCRYPTION_KEY"]) {
      for (const value of ["", " "]) rejects({ ...googleTest, [key]: value });
    }
    for (const result of [check(googleTest), check({ ...googleTest, GOOGLE_REDIRECT_URI: "wrong" })]) {
      expect(result.stdout + result.stderr).not.toContain(googleTest.GOOGLE_CLIENT_SECRET);
      expect(result.stdout + result.stderr).not.toContain(googleTest.YIBO_TOKEN_ENCRYPTION_KEY);
    }
  });
  it("requires an exact hosted callback and rejects raw-IP Google callbacks", () => {
    for (const uri of ["http://staging.synthetic-yibo.net/api/integrations/google/callback",
      googleTest.GOOGLE_REDIRECT_URI + "/", googleTest.GOOGLE_REDIRECT_URI + "?extra=1",
      "https://other.synthetic-yibo.net/api/integrations/google/callback"]) {
      rejects({ ...googleTest, GOOGLE_REDIRECT_URI: uri });
    }
    rejects({ ...googleTest, YIBO_PUBLIC_HOSTNAME: "8.8.4.4",
      YIBO_DASHBOARD_ORIGIN: "https://8.8.4.4",
      GOOGLE_REDIRECT_URI: "https://8.8.4.4/api/integrations/google/callback" });
  });
  it("rejects primary, personal, malformed and non-Google calendar IDs", () => {
    for (const id of ["primary", "owner@example.test", "calendar@group.calendar.google.com.evil.test",
      "https://calendar.google.com/", "a/b@group.calendar.google.com"]) {
      rejects({ ...googleTest, GOOGLE_CALENDAR_ID: id });
    }
  });
  it("requires usable client syntax and a distinct encryption key matching the token store", () => {
    rejects({ ...googleTest, GOOGLE_CLIENT_ID: "not-a-google-client" });
    rejects({ ...googleTest, GOOGLE_CLIENT_SECRET: "short" });
    rejects({ ...googleTest, GOOGLE_CLIENT_SECRET: googleTest.GOOGLE_CLIENT_SECRET + "\n" });
    for (const key of ["1".repeat(63), "g".repeat(64)]) {
      rejects({ ...googleTest, YIBO_TOKEN_ENCRYPTION_KEY: key });
    }
    rejects({ ...googleTest, YIBO_ADMIN_SESSION_KEY: googleTest.YIBO_TOKEN_ENCRYPTION_KEY });
    rejects({ ...googleTest, YIBO_ADMIN_SESSION_KEY: ` ${googleTest.YIBO_TOKEN_ENCRYPTION_KEY} ` });
  });
  it("still rejects other providers, exported Google grants and AWS keys", () => {
    for (const key of ["OPENAI_API_KEY", "ASTERISK_ARI_PASSWORD", "YIBO_ASTERISK_MEDIA_HOST",
      "TELNYX_API_KEY", "RESEND_API_KEY", "YIBO_EMAIL_FROM", "GOOGLE_REFRESH_TOKEN",
      "GOOGLE_APPLICATION_CREDENTIALS", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]) {
      rejects({ ...googleTest, [key]: "synthetic-sensitive-marker" });
    }
  });
  it("retains loopback, tenant, region, runtime, recording and dialing restrictions", () => {
    const variations: Array<Record<string, string>> = [{ HOST: "0.0.0.0" }, { PORT: "4317" }, { YIBO_TENANT_ID: "real-business" },
      { YIBO_REGION: "MX" }, { YIBO_DATABASE_MX: "/var/lib/yibo/mx.sqlite" },
      { YIBO_RUNTIME: "openai-realtime" }, { YIBO_CALL_RECORDING: "on" },
      { YIBO_OUTBOUND_DIALING: "enabled" }, { DOTENV_CONFIG_PATH: ".env" }];
    for (const changes of variations) {
      rejects({ ...googleTest, ...changes });
    }
  });
  it("leaves the checked-in Google template unable to start until privately configured", () => {
    const example = Object.fromEntries(readFileSync("deploy/aws/lightsail/google-calendar-test.env.example", "utf8")
      .split("\n").filter(line => line && !line.startsWith("#"))
      .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
    rejects(example);
    expect(example.YIBO_DATABASE_US).toBe(googleTest.YIBO_DATABASE_US);
    expect(example.GOOGLE_CLIENT_SECRET).toBe("");
    expect(example.YIBO_TOKEN_ENCRYPTION_KEY).toBe("");
  });
});
