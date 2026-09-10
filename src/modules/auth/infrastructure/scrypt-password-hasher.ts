import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { PasswordHasher } from "../ports/admin-identity-repository.js";

const KEY_LENGTH = 32;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await derive(password, salt);
    return ["scrypt", COST, BLOCK_SIZE, PARALLELIZATION, salt.toString("base64url"), key.toString("base64url")].join("$");
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    const [algorithm, cost, blockSize, parallelization, saltValue, keyValue] = encodedHash.split("$");
    if (algorithm !== "scrypt" || Number(cost) !== COST || Number(blockSize) !== BLOCK_SIZE
      || Number(parallelization) !== PARALLELIZATION || !saltValue || !keyValue) return false;
    try {
      const expected = Buffer.from(keyValue, "base64url");
      const actual = await derive(password, Buffer.from(saltValue, "base64url"));
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }
}

const derive = async (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLELIZATION }, (error, key) => {
      if (error) reject(error);
      else resolve(Buffer.from(key));
    });
  });
