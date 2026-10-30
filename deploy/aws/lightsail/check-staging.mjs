// Deployment-only guard. Reads environment; never opens a DB or contacts a provider.
// Existing runtime/business configuration and production services are unchanged.
import { isIPv4 } from "node:net";

const env = process.env;
let code;
const required = {
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: "3000",
  DOTENV_CONFIG_PATH: "/dev/null",
  YIBO_RUNTIME: "in-memory",
  YIBO_TENANT_ID: "tenant-yibo-demo-us",
  YIBO_REGION: "US",
  YIBO_DATABASE_US: "/var/lib/yibo/staging-us.sqlite",
  YIBO_INSTANCE_LOCK: "1",
  YIBO_INSTANCE_LOCK_PATH: "/var/lib/yibo/staging-instance.lock",
  YIBO_CALL_RECORDING: "off",
  YIBO_OUTBOUND_DIALING: "off",
};
if (Object.entries(required).some(([key, value]) => env[key] !== value)
  || env.YIBO_DATABASE_MX?.trim()) code = "STAGING_CONFIGURATION_REQUIRED";

const forbidden = /^(OPENAI_|GOOGLE_|ASTERISK_|TELNYX_|RESEND_|YIBO_ASTERISK_|YIBO_EMAIL_|YIBO_TOKEN_ENCRYPTION_KEY$|AWS_ACCESS_KEY_ID$|AWS_SECRET_ACCESS_KEY$|AWS_SESSION_TOKEN$)/;
if (Object.entries(env).some(([key, value]) => forbidden.test(key) && value?.trim())) {
  code = "STAGING_PROVIDER_CREDENTIALS_FORBIDDEN";
}

const hostname = env.YIBO_PUBLIC_HOSTNAME ?? "";
// Accept only ordinary public IPv4 for the no-domain staging option. The operator
// must verify ownership/attachment in Lightsail; syntax alone cannot prove that.
const [a, b, c] = hostname.split(".").map(Number);
const publicIPv4 = isIPv4(hostname)
  && a !== 0 && a !== 10 && a !== 127 && a < 224
  && !(a === 100 && b >= 64 && b <= 127)
  && !(a === 169 && b === 254)
  && !(a === 172 && b >= 16 && b <= 31)
  && !(a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99)))
  && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
  && !(a === 203 && b === 0 && c === 113);
const validHostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)
  && !/(?:^|\.)(?:localhost|invalid|test|example|example\.com|example\.net|example\.org)$/.test(hostname);
if ((!validHostname && !publicIPv4) || env.YIBO_DASHBOARD_ORIGIN !== `https://${hostname}`) {
  code = "STAGING_APPROVED_HTTPS_ORIGIN_REQUIRED";
}
if (Buffer.byteLength(env.YIBO_ADMIN_SESSION_KEY?.trim() ?? "", "utf8") < 32) {
  code = "STAGING_PRIVATE_SESSION_KEY_REQUIRED";
}

// Never include environment values (especially keys) in service logs.
console[code ? "error" : "log"](JSON.stringify({
  event: code ? "staging.preflight.failed" : "staging.preflight.passed",
  ...(code ? { code } : {}),
}));
process.exitCode = code ? 1 : 0;
