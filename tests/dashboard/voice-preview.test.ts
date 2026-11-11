import { describe, expect, it } from "vitest";
import { previewBlockReason, voiceLabConnection } from "../../dashboard/src/services/voice-preview.js";

const ready = { tenantId: "tenant-a", runtime: "openai-realtime", configurationSource: "saved", model: "gpt-realtime-2.1", voice: "marin" };
describe("Voice Lab endpoint selection", () => {
  it.each([false, true])("always uses authenticated same-origin WSS for HTTPS (dev=%s)", development => {
    expect(voiceLabConnection(new URL("https://staging.getyibo.com"), development))
      .toEqual({ hosted: true, url: "wss://staging.getyibo.com/api/voice-lab/stream" });
  });
  it("preserves the loopback development harness and uses the API for production builds", () => {
    expect(voiceLabConnection(new URL("http://product-acceptance.localhost:5380"), true))
      .toEqual({ hosted: false, url: "ws://product-acceptance.localhost:4317/voice" });
    expect(voiceLabConnection(new URL("http://localhost:5380"), false))
      .toEqual({ hosted: true, url: "ws://localhost:5380/api/voice-lab/stream" });
  });
});
describe("saved Voice Lab preview readiness", () => {
  it("waits for server metadata before allowing a chargeable preview", () => {
    expect(previewBlockReason("tenant-a", undefined)).toContain("Waiting");
  });
  it("allows a real runtime using saved settings for the authenticated tenant", () => {
    expect(previewBlockReason("tenant-a", ready)).toBeUndefined();
  });
  it.each([undefined, "tenant-b"])("blocks missing or mismatched tenant context (%s)", (tenant) => {
    expect(previewBlockReason(tenant, ready)).toContain("different tenant");
  });
  it("does not present a scripted runtime as an OpenAI voice preview", () => {
    expect(previewBlockReason("tenant-a", { ...ready, runtime: "in-memory" })).toContain("OpenAI Realtime");
  });
  it.each([{ configurationSource: "draft" }, { voice: undefined }, { model: undefined }])("rejects unidentified saved configuration %j", (metadata) => {
    expect(previewBlockReason("tenant-a", { ...ready, ...metadata })).toContain("saved model and voice");
  });
});
