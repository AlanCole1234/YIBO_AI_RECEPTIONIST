import { describe, expect, it } from "vitest";
import { SignedAdminSession } from "../../src/modules/auth/index.js";

const secret = "a-development-test-secret-that-is-long-enough";

describe("SignedAdminSession", () => {
  it("verifies issued claims and rejects tampering, expiry and revocation", async () => {
    const sessions = new SignedAdminSession(secret);
    const now = new Date("2026-09-10T10:00:00.000Z");
    const token = await sessions.issue({
      subject: "admin-1",
      tenantId: "tenant-a",
      roles: ["operator"],
      now,
      expiresAt: new Date("2026-09-10T18:00:00.000Z"),
    });

    await expect(sessions.verify(token, now)).resolves.toMatchObject({
      ok: true,
      principal: { subject: "admin-1", tenantId: "tenant-a", roles: ["operator"] },
    });
    await expect(sessions.verify(`${token}x`, now)).resolves.toEqual({ ok: false, code: "INVALID_SESSION" });
    await expect(sessions.verify(token, new Date("2026-09-10T18:00:00.000Z")))
      .resolves.toEqual({ ok: false, code: "EXPIRED_SESSION" });

    const fresh = await sessions.issue({
      subject: "admin-1", tenantId: "tenant-a", roles: ["operator"], now,
      expiresAt: new Date("2026-09-10T18:00:00.000Z"),
    });
    await sessions.revoke(fresh);
    await expect(sessions.verify(fresh, now)).resolves.toEqual({ ok: false, code: "REVOKED_SESSION" });
  });
});
