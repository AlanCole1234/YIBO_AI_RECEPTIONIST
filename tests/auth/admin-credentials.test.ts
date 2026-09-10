import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ScryptPasswordHasher } from "../../src/modules/auth/index.js";

describe("administrative credentials", () => {
  it("hashes passwords and verifies without storing the plaintext", async () => {
    const hasher = new ScryptPasswordHasher();
    const encoded = await hasher.hash("a-secure-password");
    expect(encoded).toMatch(/^scrypt\$/);
    expect(encoded).not.toContain("a-secure-password");
    await expect(hasher.verify("a-secure-password", encoded)).resolves.toBe(true);
    await expect(hasher.verify("wrong-password", encoded)).resolves.toBe(false);
  });

  it("persists a unique tenant-scoped identity and authenticates it", () => {
    const output = execFileSync(process.execPath, [
      "--import", "tsx", "tests/fixtures/sqlite-admin-credentials.ts",
    ], { encoding: "utf8", cwd: process.cwd() });

    expect(JSON.parse(output.trim())).toEqual({
      created: {
        subject: "admin-1",
        tenantId: "tenant-yibo-demo",
        email: "admin@yibo.example",
        roles: ["tenant_admin"],
      },
      authenticated: true,
      wrongPasswordRejected: true,
      duplicateRejected: true,
    });
  });
});
