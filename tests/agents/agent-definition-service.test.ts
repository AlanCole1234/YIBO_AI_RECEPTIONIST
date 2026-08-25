import { describe, expect, it, vi } from "vitest";
import {
  AgentDefinitionService,
  InMemoryAgentConfigurationSource,
  type ToolExecutor,
} from "../../src/modules/agents/index.js";

describe("AgentDefinitionService", () => {
  it("prepares instructions, approved tools, executor and trusted context", async () => {
    const toolExecutor: ToolExecutor = { execute: vi.fn() };
    const service = new AgentDefinitionService(
      new InMemoryAgentConfigurationSource([{
        tenantId: "tenant-a",
        configuration: {
          instructions: "Be helpful", locale: "es-MX", voice: "neutral",
          enabledTools: ["check_availability", "create_appointment", "cancel_appointment", "transfer_to_human"],
          conversation: { model: "gpt-realtime-2.1", maxOutputTokens: 512, reasoningEffort: "minimal", turnDetection: {} },
        },
      }]),
      toolExecutor,
    );

    const result = await service.prepare({
      tenantId: "tenant-a",
      callId: "call-1",
      customerId: "customer-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      instructions: "Be helpful",
      locale: "es-MX",
      voice: "neutral",
      conversation: { model: "gpt-realtime-2.1", maxOutputTokens: 512, reasoningEffort: "minimal", turnDetection: {} },
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "check_availability" }),
        expect.objectContaining({ name: "create_appointment" }),
        expect.objectContaining({ name: "cancel_appointment" }),
        expect.objectContaining({ name: "transfer_to_human" }),
      ]),
      toolExecutor,
      trustedContext: {
        tenantId: "tenant-a",
        callId: "call-1",
        customerId: "customer-1",
      },
    });
  });

  it("fails safely when the tenant has no agent configuration", async () => {
    const service = new AgentDefinitionService(
      new InMemoryAgentConfigurationSource([]),
      { execute: vi.fn() },
    );

    await expect(service.prepare({ tenantId: "tenant-a", callId: "call-1" })).resolves.toEqual({
      ok: false,
      error: { code: "CONFIGURATION_NOT_FOUND" },
    });
  });
});
