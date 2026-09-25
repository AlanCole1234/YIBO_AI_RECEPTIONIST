import { describe, expect, it } from "vitest";
import { buildApplication } from "../../src/bootstrap/index.js";
import {
  phoneTurnDetectionModes,
  validateAgentCapabilityFields,
} from "../../dashboard/src/services/agent-capability-controls.js";
import type {
  AgentConfiguration,
  RealtimeModelCapability,
} from "../../dashboard/src/services/api.js";

async function fixture() {
  const app = buildApplication();
  const configuration = await app.agentConfiguration.get(app.tenantId) as unknown as AgentConfiguration;
  const capability = app.agentConfiguration.modelCapabilities()
    .find(({ id }) => id === configuration.conversation.model) as unknown as RealtimeModelCapability;
  return { configuration: structuredClone(configuration), capability };
}

describe("dashboard agent capability controls", () => {
  it("uses the backend registry and hides manual turns from the phone editor", async () => {
    const { configuration, capability } = await fixture();

    expect(phoneTurnDetectionModes(capability)).toEqual(["server_vad", "semantic_vad"]);
    expect(validateAgentCapabilityFields(configuration, capability)).toEqual({});
  });

  it("returns field-specific errors for incompatible model controls", async () => {
    const { configuration, capability } = await fixture();
    configuration.audio.voice = "unsupported-voice";
    configuration.conversation.maxOutputTokens = capability.limits.responseOutputTokens.maximum + 1;
    configuration.audio.turnDetection = { type: "manual" };

    expect(validateAgentCapabilityFields(configuration, capability)).toMatchObject({
      voice: expect.stringContaining("not supported"),
      maxOutputTokens: expect.stringContaining(String(capability.limits.responseOutputTokens.maximum)),
      turnDetection: expect.stringContaining("phone calls"),
    });
  });

  it("validates server VAD values against the selected model ranges", async () => {
    const { configuration, capability } = await fixture();
    configuration.audio.turnDetection = {
      type: "server_vad",
      createResponse: true,
      interruptResponse: true,
      threshold: capability.controls.serverVad.threshold.maximum + 1,
    };

    expect(validateAgentCapabilityFields(configuration, capability)).toHaveProperty("threshold");
  });
});
