import { describe, expect, it } from "vitest";
import {
  AgentConfigurationService,
  createDefaultAgentBehavior,
  InMemoryAgentConfigurationSource,
  upgradeAgentConfiguration,
} from "../../src/modules/agents/index.js";

describe("AgentConfigurationService", () => {
  it("provides a safe recommendation and persists validated capability changes", async () => {
    const repository = new InMemoryAgentConfigurationSource([]);
    const service = new AgentConfigurationService(repository);
    const recommended = service.recommended("es-MX", "Clínica YIBO", "gpt-realtime-2.1");

    expect(recommended.enabledTools).toEqual([
      "check_availability", "create_appointment", "update_customer", "cancel_appointment", "reschedule_appointment", "transfer_to_human",
    ]);
    expect(recommended).toMatchObject({
      schemaVersion: 3,
      identity: { locale: "es-MX" },
      audio: {
        voice: "marin",
        noiseReduction: "near_field",
        turnDetection: {
          type: "server_vad",
          silenceDurationMs: 800,
          idleTimeoutMs: 6000,
          createResponse: true,
          interruptResponse: true,
        },
      },
      behavior: createDefaultAgentBehavior("es-MX"),
      conversation: {
        model: "gpt-realtime-2.1",
        maxOutputTokens: 512,
        reasoningEffort: "minimal",
        tracing: "disabled",
        truncation: { mode: "auto" },
      },
    });
    recommended.enabledTools = ["check_availability"];
    const saved = await service.update("tenant-1", recommended);

    await expect(service.get("tenant-1")).resolves.toEqual(saved);
  });

  it("upgrades unversioned documents conservatively and rejects unknown future versions", async () => {
    const repository = new InMemoryAgentConfigurationSource([{
      tenantId: "tenant-legacy",
      configuration: {
        instructions: "Keep this prompt", locale: "es-MX", voice: "cedar",
        enabledTools: ["check_availability"],
        conversation: { model: "gpt-realtime-2.1", maxOutputTokens: 321, reasoningEffort: "low", turnDetection: {} },
      },
    }]);
    const service = new AgentConfigurationService(repository);
    await expect(service.get("tenant-legacy")).resolves.toEqual({
      schemaVersion: 3,
      identity: { instructions: "Keep this prompt", locale: "es-MX" },
      enabledTools: ["check_availability"],
      conversation: {
        model: "gpt-realtime-2.1", maxOutputTokens: 321, reasoningEffort: "low",
        tracing: "disabled", truncation: { mode: "auto" },
      },
      audio: {
        voice: "cedar", noiseReduction: "near_field",
        turnDetection: {
          type: "server_vad", createResponse: true, interruptResponse: true, idleTimeoutMs: 6000,
          silenceDurationMs: 800,
        },
      },
      behavior: createDefaultAgentBehavior("es-MX"),
    });
    await expect(service.update("tenant-legacy", {
      schemaVersion: 99,
      instructions: "future",
    } as never)).rejects.toThrow("unsupported agent configuration schemaVersion");
  });

  it("upgrades an explicit v1 document to v3 idempotently", () => {
    const upgraded = upgradeAgentConfiguration({
      schemaVersion: 1,
      instructions: "Preserve these instructions",
      locale: "en-US",
      voice: "marin",
      enabledTools: ["check_availability"],
      conversation: {
        model: "gpt-realtime-2.1-mini",
        maxOutputTokens: 256,
        reasoningEffort: "medium",
        turnDetection: {
          threshold: 0.65,
          prefixPaddingMs: 240,
          silenceDurationMs: 900,
        },
      },
    });

    expect(upgraded).toMatchObject({
      schemaVersion: 3,
      identity: { instructions: "Preserve these instructions", locale: "en-US" },
      conversation: {
        model: "gpt-realtime-2.1-mini",
        maxOutputTokens: 256,
        reasoningEffort: "medium",
        tracing: "disabled",
        truncation: { mode: "auto" },
      },
      audio: {
        voice: "marin",
        noiseReduction: "near_field",
        turnDetection: {
          type: "server_vad",
          threshold: 0.65,
          prefixPaddingMs: 240,
          silenceDurationMs: 900,
          idleTimeoutMs: 6000,
          createResponse: true,
          interruptResponse: true,
        },
      },
    });
    expect(upgradeAgentConfiguration(upgraded)).toEqual(upgraded);
  });

  it("upgrades v2 behavior defaults and validates structured behavior", async () => {
    const v2 = createV2Configuration();
    expect(upgradeAgentConfiguration(v2)).toMatchObject({
      schemaVersion: 3,
      behavior: createDefaultAgentBehavior("es-MX"),
    });

    const service = new AgentConfigurationService(new InMemoryAgentConfigurationSource([]));
    const configured = service.recommended("es-MX", "YIBO", "gpt-realtime-2.1");
    configured.behavior = {
      greeting: { mode: "automatic", message: "Gracias por llamar a YIBO." },
      responseStyle: { brevity: "balanced", tone: "professional", pace: "slow" },
      silence: { message: "¿Sigue en la línea?", maxPrompts: 2 },
      slotOffering: { maximumOptions: 3, strategy: "spread_across_day" },
      dataCollectionOrder: ["service", "full_name", "phone_number"],
    };
    await expect(service.update("tenant-1", configured)).resolves.toEqual(configured);

    configured.behavior.dataCollectionOrder = ["service", "service", "phone_number"];
    await expect(service.update("tenant-1", configured)).rejects.toThrow("dataCollectionOrder");
  });

  it("rejects unknown tools and unsafe output limits", async () => {
    const service = new AgentConfigurationService(new InMemoryAgentConfigurationSource([]));
    const value = service.recommended("es-MX", "YIBO", "gpt-realtime-2.1");
    value.conversation.maxOutputTokens = 0;
    await expect(service.update("tenant-1", value)).rejects.toThrow();
  });

  it("publishes model capabilities and rejects incompatible model options", async () => {
    const service = new AgentConfigurationService(new InMemoryAgentConfigurationSource([]));
    expect(service.modelCapabilities()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "gpt-realtime-2.1",
        voices: expect.arrayContaining(["marin", "cedar"]),
        limits: expect.objectContaining({
          contextWindowTokens: 128_000,
          modelMaxOutputTokens: 32_000,
          responseOutputTokens: { minimum: 1, maximum: 4_096, uiMinimum: 64, step: 64 },
        }),
        controls: expect.objectContaining({ reasoningEfforts: ["minimal", "low", "medium", "high"] }),
      }),
    ]));

    const unknownModel = service.recommended("es-MX", "YIBO", "gpt-realtime-2.1");
    unknownModel.conversation.model = "unknown-realtime-model";
    await expect(service.update("tenant-1", unknownModel)).rejects.toThrow("conversation.model is not supported");

    const unknownVoice = service.recommended("es-MX", "YIBO", "gpt-realtime-2.1");
    unknownVoice.audio.voice = "unlisted-voice";
    await expect(service.update("tenant-1", unknownVoice)).rejects.toThrow("voice is not supported");
  });

  it("validates mode-specific audio, tracing and truncation controls", async () => {
    const service = new AgentConfigurationService(new InMemoryAgentConfigurationSource([]));
    const semantic = service.recommended("es-MX", "YIBO", "gpt-realtime-2.1");
    semantic.audio.noiseReduction = "far_field";
    semantic.audio.turnDetection = {
      type: "semantic_vad", eagerness: "low", createResponse: false, interruptResponse: true,
    };
    semantic.conversation.tracing = "auto";
    semantic.conversation.truncation = {
      mode: "retention_ratio", retentionRatio: 0.8, postInstructionsTokens: 12_000,
    };
    await expect(service.update("tenant-1", semantic)).resolves.toEqual(semantic);

    const invalidIdle = service.recommended("es-MX", "YIBO", "gpt-realtime-2.1");
    if (invalidIdle.audio.turnDetection.type === "server_vad") {
      invalidIdle.audio.turnDetection.idleTimeoutMs = 120_001;
    }
    await expect(service.update("tenant-1", invalidIdle)).rejects.toThrow("idleTimeoutMs");

    const invalidRetention = service.recommended("es-MX", "YIBO", "gpt-realtime-2.1");
    invalidRetention.conversation.truncation = { mode: "retention_ratio", retentionRatio: 0 };
    await expect(service.update("tenant-1", invalidRetention)).rejects.toThrow("retentionRatio");
  });
});

function createV2Configuration() {
  return {
    schemaVersion: 2 as const,
    identity: { instructions: "Keep v2 guidance", locale: "es-MX" },
    enabledTools: ["check_availability" as const],
    conversation: {
      model: "gpt-realtime-2.1", maxOutputTokens: 512, reasoningEffort: "minimal" as const,
      tracing: "disabled" as const, truncation: { mode: "auto" as const },
    },
    audio: {
      voice: "marin", noiseReduction: "near_field" as const,
      turnDetection: {
        type: "server_vad" as const, createResponse: true, interruptResponse: true,
        idleTimeoutMs: 6000, silenceDurationMs: 800,
      },
    },
  };
}
