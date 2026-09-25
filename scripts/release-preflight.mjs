import { existsSync } from "node:fs";

const env = process.env;
const errors = [];
const required = [
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

for (const name of ["YIBO_DATABASE_MX", "YIBO_DATABASE_US"]) {
  const value = env[name]?.trim();
  if (value && !existsSync(value)) errors.push(`${name} does not exist: ${value}`);
}

if (errors.length) {
  console.error("Release preflight FAILED:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("Release preflight passed: required production configuration is present.");
console.log("Live PBX, OpenAI, Google Calendar, email delivery, backup/restore and end-to-end acceptance still require operator execution.");
