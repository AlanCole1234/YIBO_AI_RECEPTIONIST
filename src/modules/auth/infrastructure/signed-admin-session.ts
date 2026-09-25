import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { AdminSessionPort } from "../ports/admin-session-port.js";
import type {
  AdminPrincipal,
  AdminSessionVerification,
  IssueAdminSessionCommand,
} from "../application/contracts.js";
import { isAdminRole } from "../application/contracts.js";

type SessionPayload = AdminPrincipal & { sessionId: string };

export class SignedAdminSession implements AdminSessionPort {
  private readonly activeSessions = new Map<string, string>();

  constructor(private readonly secret: string) {
    if (Buffer.byteLength(secret) < 32) throw new Error("Admin session secret must be at least 32 bytes");
  }

  async issue(command: IssueAdminSessionCommand): Promise<string> {
    const payload: SessionPayload = {
      subject: command.subject,
      tenantId: command.tenantId,
      roles: [...new Set(command.roles)],
      issuedAt: command.now.toISOString(),
      expiresAt: command.expiresAt.toISOString(),
      sessionId: randomUUID(),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = this.sign(encoded);
    this.activeSessions.set(payload.sessionId, payload.expiresAt);
    return `${encoded}.${signature}`;
  }

  async verify(token: string, now: Date): Promise<AdminSessionVerification> {
    const [encoded, providedSignature, extra] = token.split(".");
    if (!encoded || !providedSignature || extra || !safeEqual(providedSignature, this.sign(encoded))) {
      return { ok: false, code: "INVALID_SESSION" };
    }
    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<SessionPayload>;
      if (!validPayload(payload)) return { ok: false, code: "INVALID_SESSION" };
      if (!this.activeSessions.has(payload.sessionId)) return { ok: false, code: "REVOKED_SESSION" };
      if (new Date(payload.expiresAt).valueOf() <= now.valueOf()) {
        this.activeSessions.delete(payload.sessionId);
        return { ok: false, code: "EXPIRED_SESSION" };
      }
      const { sessionId: _, ...principal } = payload;
      return { ok: true, principal };
    } catch {
      return { ok: false, code: "INVALID_SESSION" };
    }
  }

  async revoke(token: string): Promise<void> {
    const [encoded] = token.split(".");
    if (!encoded) return;
    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<SessionPayload>;
      if (typeof payload.sessionId === "string") this.activeSessions.delete(payload.sessionId);
    } catch { /* Invalid tokens are already unusable. */ }
  }

  private sign(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("base64url");
  }
}

const validPayload = (value: Partial<SessionPayload>): value is SessionPayload =>
  typeof value.subject === "string" && typeof value.tenantId === "string"
  && Array.isArray(value.roles) && value.roles.length > 0
  && value.roles.every(isAdminRole)
  && typeof value.issuedAt === "string" && !Number.isNaN(new Date(value.issuedAt).valueOf())
  && typeof value.expiresAt === "string" && !Number.isNaN(new Date(value.expiresAt).valueOf())
  && typeof value.sessionId === "string";

const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};
