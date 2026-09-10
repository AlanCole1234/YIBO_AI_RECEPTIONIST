import { describe, expect, it } from "vitest";
import {
  AgentConfigurationService,
  InMemoryAgentConfigurationSource,
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
      schemaVersion: 1,
      voice: "marin",
      conversation: {
        model: "gpt-realtime-2.1",
        maxOutputTokens: 512,
        reasoningEffort: "minimal",
        turnDetection: { silenceDurationMs: 800 },
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
      schemaVersion: 1,
      instructions: "Keep this prompt", locale: "es-MX", voice: "cedar",
      enabledTools: ["check_availability"],
      conversation: { model: "gpt-realtime-2.1", maxOutputTokens: 321, reasoningEffort: "low", turnDetection: {} },
    });
    await expect(service.update("tenant-legacy", {
      schemaVersion: 99,
      instructions: "future",
    } as never)).rejects.toThrow("unsupported agent configuration schemaVersion");
  });

  it("rejects unknown tools and unsafe output limits", async () => {
    const service = new AgentConfigurationService(new InMemoryAgentConfigurationSource([]));
    const value = service.recommended("es-MX", "YIBO", "gpt-realtime-2.1");
    value.conversation.maxOutputTokens = 0;
    await expect(service.update("tenant-1", value)).rejects.toThrow();
  });
});
