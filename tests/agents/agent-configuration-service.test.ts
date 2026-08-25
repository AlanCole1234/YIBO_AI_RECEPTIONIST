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
      "check_availability", "create_appointment", "cancel_appointment", "transfer_to_human",
    ]);
    recommended.enabledTools = ["check_availability"];
    const saved = await service.update("tenant-1", recommended);

    await expect(service.get("tenant-1")).resolves.toEqual(saved);
  });

  it("rejects unknown tools and unsafe output limits", async () => {
    const service = new AgentConfigurationService(new InMemoryAgentConfigurationSource([]));
    const value = service.recommended("es-MX", "YIBO", "gpt-realtime-2.1");
    value.conversation.maxOutputTokens = 0;
    await expect(service.update("tenant-1", value)).rejects.toThrow();
  });
});
