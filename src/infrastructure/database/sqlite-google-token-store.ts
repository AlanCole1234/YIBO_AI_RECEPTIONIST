import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { GoogleToken, GoogleTokenStore } from "../../modules/integrations/index.js";
import type { RegionId } from "../../shared/types/identifiers.js";

export class SqliteGoogleTokenStore implements GoogleTokenStore {
  private readonly key: Buffer;

  constructor(private readonly database: DatabaseSync, private readonly region: RegionId, encryptionKey: string | undefined) {
    if (!encryptionKey || !/^[0-9a-f]{64}$/i.test(encryptionKey)) {
      throw new Error("YIBO_TOKEN_ENCRYPTION_KEY must be a 64-character hexadecimal value.");
    }
    this.key = Buffer.from(encryptionKey, "hex");
  }

  async get(tenantId: string): Promise<GoogleToken | null> {
    const row = this.database.prepare(`SELECT encrypted_token FROM google_calendar_tokens WHERE region_id = ? AND tenant_id = ?`)
      .get(this.region, tenantId) as { encrypted_token: string } | undefined;
    return row ? decrypt(row.encrypted_token, this.key) : null;
  }

  async save(tenantId: string, token: GoogleToken): Promise<void> {
    this.database.prepare(`
      INSERT INTO google_calendar_tokens(region_id, tenant_id, encrypted_token, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(region_id, tenant_id) DO UPDATE SET encrypted_token = excluded.encrypted_token, updated_at = excluded.updated_at
    `).run(this.region, tenantId, encrypt(token, this.key), new Date().toISOString());
  }
}

const encrypt = (token: GoogleToken, key: Buffer): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(token), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), payload]).toString("base64");
};

const decrypt = (value: string, key: Buffer): GoogleToken => {
  const data = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8")) as GoogleToken;
};
