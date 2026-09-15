import { describe, expect, it } from "vitest";
import { previewBlockReason } from "../../dashboard/src/services/voice-preview.js";

const ready = { tenantId: "tenant-a", runtime: "openai-realtime", configurationSource: "saved", model: "gpt-realtime-2.1", voice: "marin" };
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
