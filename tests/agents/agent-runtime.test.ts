import { describe, expect, it, vi } from "vitest";
import { failure, success } from "../../src/shared/domain/result.js";
import {
  AgentRuntimeImpl,
  InMemoryAgentConfigurationProvider,
  type AgentAIProvider,
  type AgentToolCall,
  type AgentToolResult,
  type ProviderAgentSession,
  type ToolExecutor,
} from "../../src/modules/agents/index.js";

class FakeProviderSession implements ProviderAgentSession {
  readonly results: AgentToolResult[] = [];
  closed = false;
  private handler?: (call: AgentToolCall) => Promise<void>;

  async sendToolResult(result: AgentToolResult): Promise<void> { this.results.push(result); }
  onToolCall(handler: (call: AgentToolCall) => Promise<void>): void { this.handler = handler; }
  async close(): Promise<void> { this.closed = true; }
  async emit(call: AgentToolCall): Promise<void> { await this.handler?.(call); }
}

describe("AgentRuntimeImpl", () => {
  it("opens a configured provider session with only approved tools and routes tool results", async () => {
    const providerSession = new FakeProviderSession();
    const openSession = vi.fn(async () => success(providerSession));
    const provider: AgentAIProvider = { openSession };
    const execute = vi.fn(async (_context, call: AgentToolCall): Promise<AgentToolResult> => ({
      toolCallId: call.toolCallId,
      ok: true,
      data: { handled: true },
    }));
    const tools: ToolExecutor = { execute };
    const runtime = new AgentRuntimeImpl(
      new InMemoryAgentConfigurationProvider([{
        tenantId: "tenant-a",
        configuration: { instructions: "Be helpful", locale: "es-MX", voice: "alloy" },
      }]),
      provider,
      tools,
    );

    const started = await runtime.startSession({
      tenantId: "tenant-a",
      callId: "call-1",
      customerId: "customer-1",
    });
    await providerSession.emit({ toolCallId: "tool-1", name: "transfer_to_human", arguments: {} });

    expect(started.ok).toBe(true);
    expect(openSession).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-a",
      callId: "call-1",
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "check_availability" }),
        expect.objectContaining({ name: "create_appointment" }),
        expect.objectContaining({ name: "cancel_appointment" }),
        expect.objectContaining({ name: "transfer_to_human" }),
      ]),
    }));
    expect(execute).toHaveBeenCalledWith(
      { tenantId: "tenant-a", callId: "call-1", customerId: "customer-1" },
      expect.objectContaining({ toolCallId: "tool-1" }),
    );
    expect(providerSession.results).toEqual([{ toolCallId: "tool-1", ok: true, data: { handled: true } }]);
  });

  it("fails safely when the tenant has no agent configuration", async () => {
    const provider: AgentAIProvider = { openSession: vi.fn() };
    const tools: ToolExecutor = { execute: vi.fn() };
    const runtime = new AgentRuntimeImpl(new InMemoryAgentConfigurationProvider([]), provider, tools);

    await expect(runtime.startSession({ tenantId: "tenant-a", callId: "call-1" })).resolves.toEqual({
      ok: false,
      error: { code: "CONFIGURATION_NOT_FOUND" },
    });
    expect(provider.openSession).not.toHaveBeenCalled();
  });

  it("maps provider outages without exposing provider details", async () => {
    const provider: AgentAIProvider = {
      openSession: vi.fn(async () => failure({ code: "PROVIDER_UNAVAILABLE" as const, retryable: true })),
    };
    const runtime = new AgentRuntimeImpl(
      new InMemoryAgentConfigurationProvider([{
        tenantId: "tenant-a",
        configuration: { instructions: "Be helpful", locale: "es-MX" },
      }]),
      provider,
      { execute: vi.fn() },
    );

    await expect(runtime.startSession({ tenantId: "tenant-a", callId: "call-1" })).resolves.toEqual({
      ok: false,
      error: { code: "AI_PROVIDER_UNAVAILABLE", retryable: true },
    });
  });
});
