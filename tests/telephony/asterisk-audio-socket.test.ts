import { describe, expect, it } from "vitest";
import { uuidFromBytes } from "../../src/modules/telephony/infrastructure/asterisk/asterisk-audio-socket-server.js";

describe("Asterisk AudioSocket framing", () => {
  it("converts the 16-byte AudioSocket stream UUID into the Stasis correlation value", () => {
    const bytes = Buffer.from("d5da4d1e12344cde9000123456789abc", "hex");
    expect(uuidFromBytes(bytes)).toBe("d5da4d1e-1234-4cde-9000-123456789abc");
  });
});
