import { existsSync } from "node:fs";

const env = process.env;
const errors = [];
const required = [
  "YIBO_TENANT_ID",
  "YIBO_REGION",
  "OPENAI_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "YIBO_TOKEN_ENCRYPTION_KEY",
  "YIBO_ADMIN_SESSION_KEY",
  "YIBO_DASHBOARD_ORIGIN",
  "RESEND_API_KEY",
  "YIBO_EMAIL_FROM",
  "ASTERISK_ARI_URL",
  "ASTERISK_ARI_APPLICATION",
  "ASTERISK_ARI_USERNAME",
  "ASTERISK_ARI_PASSWORD",
  "YIBO_ASTERISK_MEDIA_HOST",
  "YIBO_ASTERISK_MEDIA_PORT_START",
  "YIBO_ASTERISK_MEDIA_PORT_END",
];

for (const name of required) {
  if (!env[name]?.trim()) errors.push(`${name} is required for a production release`);
}

const region = env.YIBO_REGION?.trim();
if (region && !["MX", "US"].includes(region)) {
  errors.push("YIBO_REGION must be MX or US");
}

if (env.YIBO_RUNTIME !== "openai-realtime") {
  errors.push("YIBO_RUNTIME must be openai-realtime for production acceptance");
}

for (const name of ["YIBO_TOKEN_ENCRYPTION_KEY", "YIBO_ADMIN_SESSION_KEY"]) {
  if (env[name] && Buffer.byteLength(env[name], "utf8") < 32) {
    errors.push(`${name} must contain at least 32 bytes`);
  }
}

try {
  const origin = new URL(env.YIBO_DASHBOARD_ORIGIN ?? "");
  if (origin.protocol !== "https:") errors.push("YIBO_DASHBOARD_ORIGIN must use HTTPS in production");
} catch {
  errors.push("YIBO_DASHBOARD_ORIGIN must be a valid HTTPS origin");
}

try {
  const redirect = new URL(env.GOOGLE_REDIRECT_URI ?? "");
  if (redirect.protocol !== "https:") errors.push("GOOGLE_REDIRECT_URI must use HTTPS in production");
} catch {
  errors.push("GOOGLE_REDIRECT_URI must be a valid HTTPS URL");
}

for (const name of ["YIBO_ASTERISK_MEDIA_PORT_START", "YIBO_ASTERISK_MEDIA_PORT_END"]) {
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    errors.push(`${name} must be an integer between 1024 and 65535`);
  }
}
const start = Number(env.YIBO_ASTERISK_MEDIA_PORT_START);
const end = Number(env.YIBO_ASTERISK_MEDIA_PORT_END);
if (Number.isInteger(start) && Number.isInteger(end) && start > end) {
  errors.push("YIBO_ASTERISK_MEDIA_PORT_START must be <= YIBO_ASTERISK_MEDIA_PORT_END");
}

if (region && ["MX", "US"].includes(region)) {
  const databaseName = `YIBO_DATABASE_${region}`;
  const databasePath = env[databaseName]?.trim();
  if (!databasePath) errors.push(`${databaseName} is required for a production release`);
  else if (!existsSync(databasePath)) errors.push(`${databaseName} does not exist: ${databasePath}`);
}

try {
  const ari = new URL(env.ASTERISK_ARI_URL ?? "");
  if (!["http:", "https:"].includes(ari.protocol)) errors.push("ASTERISK_ARI_URL must use HTTP or HTTPS");
} catch {
  errors.push("ASTERISK_ARI_URL must be a valid HTTP(S) URL");
}

if (env.PORT) {
  const port = Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push("PORT must be an integer between 1 and 65535");
}

if (errors.length) {
  console.error("Release preflight FAILED:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("Release preflight passed: required production configuration is present.");
console.log("Live PBX, OpenAI, Google Calendar, email delivery, backup/restore and end-to-end acceptance still require operator execution.");
