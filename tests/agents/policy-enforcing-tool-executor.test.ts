import { describe, expect, it, vi } from "vitest";
import {
  PolicyEnforcingToolExecutor,
  createDefaultToolPolicies,
  type AgentToolCall,
  type ToolExecutor,
} from "../../src/modules/agents/index.js";

const context = {
  tenantId: "tenant-a",
  locationId: "default",
  callId: "call-1",
  customerId: "customer-1",
  turnSequence: 1,
};
const availabilityCall: AgentToolCall = {
  toolCallId: "tool-1",
  name: "check_availability",
  arguments: {},
};

describe("PolicyEnforcingToolExecutor", () => {
  it("rejects a tool that is not enabled for the resolved channel", async () => {
    const execute = vi.fn<ToolExecutor["execute"]>();
    const executor = new PolicyEnforcingToolExecutor({ execute }, [], createDefaultToolPolicies([]));

    await expect(executor.execute(context, availabilityCall)).resolves.toMatchObject({
      ok: false,
      error: { code: "TOOL_DISABLED", retryable: false },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("enforces per-call limits and transfers through the trusted destination when configured", async () => {
    const execute = vi.fn<ToolExecutor["execute"]>(async (_context, call) => ({
      toolCallId: call.toolCallId,
      ok: true,
      data: call.name === "transfer_to_human" ? { transferred: true } : { slots: [] },
    }));
    const policy = createDefaultToolPolicies(["check_availability", "transfer_to_human"]);
    policy.limits.totalPerCall = 1;
    policy.automaticTransfer.onLimitReached = true;
    const executor = new PolicyEnforcingToolExecutor(
      { execute },
      ["check_availability", "transfer_to_human"],
      policy,
    );

    await expect(executor.execute(context, availabilityCall)).resolves.toMatchObject({ ok: true });
    await expect(executor.execute(context, { ...availabilityCall, toolCallId: "tool-2" })).resolves.toMatchObject({
      ok: false,
      error: { code: "TOOL_CALL_LIMIT_REACHED", messageForAgent: expect.stringContaining("transfer") },
    });
    expect(execute).toHaveBeenLastCalledWith(context, {
      toolCallId: "tool-2:automatic-transfer",
      name: "transfer_to_human",
      arguments: {},
    });
  });

  it("retries only retryable failures and then applies automatic transfer", async () => {
    const execute = vi.fn<ToolExecutor["execute"]>(async (_context, call) => call.name === "transfer_to_human"
      ? { toolCallId: call.toolCallId, ok: true, data: { transferred: true } }
      : {
          toolCallId: call.toolCallId,
          ok: false,
          error: { code: "EXTERNAL_CALENDAR_UNAVAILABLE", messageForAgent: "Calendar unavailable.", retryable: true },
        });
    const policy = createDefaultToolPolicies(["check_availability", "transfer_to_human"]);
    policy.externalRetryAttempts = 2;
    policy.automaticTransfer.onRetryableFailure = true;
    const executor = new PolicyEnforcingToolExecutor(
      { execute },
      ["check_availability", "transfer_to_human"],
      policy,
    );

    await expect(executor.execute(context, availabilityCall)).resolves.toMatchObject({
      ok: false,
      error: { retryable: false, messageForAgent: expect.stringContaining("transfer") },
    });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("enforces an individual tool limit without exhausting other tools", async () => {
    const execute = vi.fn<ToolExecutor["execute"]>(async (_context, call) => ({
      toolCallId: call.toolCallId, ok: true, data: {},
    }));
    const policy = createDefaultToolPolicies(["check_availability", "get_service_information"]);
    policy.limits.totalPerCall = 5;
    policy.limits.perTool.check_availability = 1;
    const executor = new PolicyEnforcingToolExecutor(
      { execute }, ["check_availability", "get_service_information"], policy,
    );

    await expect(executor.execute(context, availabilityCall)).resolves.toMatchObject({ ok: true });
    await expect(executor.execute(context, { ...availabilityCall, toolCallId: "availability-over-limit" }))
      .resolves.toMatchObject({ ok: false, error: { code: "TOOL_CALL_LIMIT_REACHED", retryable: false } });
    await expect(executor.execute(context, {
      toolCallId: "service-info", name: "get_service_information", arguments: {},
    })).resolves.toMatchObject({ ok: true });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("converts unexpected tool and transfer exceptions into safe errors", async () => {
    const execute = vi.fn<ToolExecutor["execute"]>(async (_context, call) => {
      throw new Error(call.name === "transfer_to_human" ? "pbx-secret-host" : "database-password-leaked");
    });
    const policy = createDefaultToolPolicies(["check_availability", "transfer_to_human"]);
    policy.limits.totalPerCall = 1;
    policy.automaticTransfer.onLimitReached = true;
    const executor = new PolicyEnforcingToolExecutor(
      { execute }, ["check_availability", "transfer_to_human"], policy,
    );

    const failure = await executor.execute(context, availabilityCall);
    expect(failure).toMatchObject({
      ok: false,
      error: { code: "TOOL_EXECUTION_FAILED", retryable: false },
    });
    expect(JSON.stringify(failure)).not.toContain("database-password-leaked");

    const limited = await executor.execute(context, { ...availabilityCall, toolCallId: "limit-with-failed-transfer" });
    expect(limited).toMatchObject({ ok: false, error: { code: "TOOL_CALL_LIMIT_REACHED" } });
    expect(JSON.stringify(limited)).not.toContain("pbx-secret-host");
  });
});
