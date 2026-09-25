import { describe, expect, it, vi } from "vitest";
import {
  ConfirmationGateToolExecutor,
  type ToolExecutor,
} from "../../src/modules/agents/index.js";

const context = {
  tenantId: "tenant-a",
  locationId: "default",
  callId: "call-1",
  customerId: "customer-1",
  turnSequence: 4,
};
const create = {
  toolCallId: "create-1",
  name: "create_appointment" as const,
  arguments: { service: "Cleaning", employeeId: "professional-public-choice", startAt: "2026-09-20T15:00:00.000Z" },
};

describe("ConfirmationGateToolExecutor", () => {
  it("issues an opaque token bound to call, action, arguments, and issuing turn without executing", async () => {
    const execute = vi.fn<ToolExecutor["execute"]>(async (_context, call) => ({
      toolCallId: call.toolCallId, ok: true, data: { confirmed: true },
    }));
    const gate = new ConfirmationGateToolExecutor({ execute }, ["create_appointment"], () => "opaque-token");

    await expect(gate.execute(context, create)).resolves.toEqual({
      toolCallId: "create-1",
      ok: false,
      error: {
        code: "CONFIRMATION_REQUIRED",
        messageForAgent: expect.stringContaining("new caller turn"),
        retryable: false,
        confirmationToken: "opaque-token",
      },
    });
    expect(execute).not.toHaveBeenCalled();

    await expect(gate.execute(context, {
      ...create,
      toolCallId: "create-confirmed-same-turn",
      arguments: { ...create.arguments, confirmationToken: "opaque-token" },
    })).resolves.toMatchObject({ ok: false, error: { code: "CONFIRMATION_PENDING_NEW_TURN" } });
    expect(execute).not.toHaveBeenCalled();

    await expect(gate.execute({ ...context, turnSequence: 5 }, {
      ...create,
      toolCallId: "create-confirmed-new-turn",
      arguments: { ...create.arguments, confirmationToken: "opaque-token" },
    })).resolves.toEqual({
      toolCallId: "create-confirmed-new-turn", ok: true, data: { confirmed: true },
    });
    expect(execute).toHaveBeenCalledWith({ ...context, turnSequence: 5 }, {
      ...create,
      toolCallId: "create-confirmed-new-turn",
      arguments: create.arguments,
    });
  });

  it("rejects a token replayed with different arguments, action, or call", async () => {
    const execute = vi.fn<ToolExecutor["execute"]>();
    const gate = new ConfirmationGateToolExecutor({ execute }, ["create_appointment", "cancel_appointment"], () => "bound-token");
    await gate.execute(context, create);

    const changedArguments = await gate.execute({ ...context, turnSequence: 5 }, {
      ...create,
      arguments: { ...create.arguments, startAt: "2026-09-20T16:00:00.000Z", confirmationToken: "bound-token" },
    });
    const changedAction = await gate.execute({ ...context, turnSequence: 5 }, {
      toolCallId: "cancel-1", name: "cancel_appointment",
      arguments: { appointmentReference: "upcoming-1", confirmationToken: "bound-token" },
    });
    const changedCall = await gate.execute({ ...context, callId: "call-2", turnSequence: 5 }, {
      ...create, arguments: { ...create.arguments, confirmationToken: "bound-token" },
    });

    for (const result of [changedArguments, changedAction, changedCall]) {
      expect(result).toMatchObject({ ok: false, error: { code: "CONFIRMATION_MISMATCH" } });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    { tenantId: "tenant-other" }, { locationId: "south" },
    { customerId: "customer-other" }, { developerTestModeAuthorized: true as const },
  ])("rejects confirmation replay under changed trusted scope %j", async (changed) => {
    const execute = vi.fn<ToolExecutor["execute"]>(async (_context, call) => ({ toolCallId: call.toolCallId, ok: true, data: {} }));
    const gate = new ConfirmationGateToolExecutor({ execute }, ["create_appointment"], () => "scope-token");
    await gate.execute(context, create);
    await expect(gate.execute({ ...context, ...changed, turnSequence: 5 }, {
      ...create, arguments: { ...create.arguments, confirmationToken: "scope-token" },
    })).resolves.toMatchObject({ ok: false, error: { code: "CONFIRMATION_MISMATCH" } });
    expect(execute).not.toHaveBeenCalled();
    await expect(gate.execute({ ...context, turnSequence: 5 }, {
      ...create, arguments: { ...create.arguments, confirmationToken: "scope-token" },
    })).resolves.toMatchObject({ ok: true });
  });

  it("passes tools without a confirmation policy through unchanged", async () => {
    const execute = vi.fn<ToolExecutor["execute"]>(async (_context, call) => ({
      toolCallId: call.toolCallId, ok: true, data: { services: [] },
    }));
    const gate = new ConfirmationGateToolExecutor({ execute }, ["create_appointment"]);
    const call = { toolCallId: "read-1", name: "get_service_information" as const, arguments: {} };

    await expect(gate.execute(context, call)).resolves.toMatchObject({ ok: true });
    expect(execute).toHaveBeenCalledWith(context, call);
  });

  it("expires after two minutes and consumes a valid token exactly once", async () => {
    let now = 1_000;
    const execute = vi.fn<ToolExecutor["execute"]>(async (_context, call) => ({
      toolCallId: call.toolCallId, ok: true, data: { confirmed: true },
    }));
    let tokenSequence = 0;
    const gate = new ConfirmationGateToolExecutor(
      { execute },
      ["create_appointment"],
      () => `token-${++tokenSequence}`,
      () => now,
    );
    await gate.execute(context, create);
    now += 120_001;
    await expect(gate.execute({ ...context, turnSequence: 5 }, {
      ...create, arguments: { ...create.arguments, confirmationToken: "token-1" },
    })).resolves.toMatchObject({ ok: false, error: { code: "CONFIRMATION_EXPIRED" } });
    expect(execute).not.toHaveBeenCalled();

    now = 500_000;
    await gate.execute(context, { ...create, toolCallId: "issue-token-2" });
    now += 120_000;
    const confirmedCall = {
      ...create,
      toolCallId: "consume-token-2",
      arguments: { ...create.arguments, confirmationToken: "token-2" },
    };
    await expect(gate.execute({ ...context, turnSequence: 5 }, confirmedCall))
      .resolves.toMatchObject({ ok: true });
    await expect(gate.execute({ ...context, turnSequence: 6 }, { ...confirmedCall, toolCallId: "replay-token-2" }))
      .resolves.toMatchObject({ ok: false, error: { code: "CONFIRMATION_MISMATCH" } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("consumes the token before delegation even when the mutation fails", async () => {
    const execute = vi.fn<ToolExecutor["execute"]>(async (_context, call) => ({
      toolCallId: call.toolCallId,
      ok: false,
      error: { code: "SLOT_NO_LONGER_AVAILABLE", messageForAgent: "Choose another slot.", retryable: false },
    }));
    const gate = new ConfirmationGateToolExecutor({ execute }, ["create_appointment"], () => "failure-token");
    await gate.execute(context, create);
    const confirmed = {
      ...create,
      arguments: { ...create.arguments, confirmationToken: "failure-token" },
    };

    await expect(gate.execute({ ...context, turnSequence: 5 }, confirmed))
      .resolves.toMatchObject({ ok: false, error: { code: "SLOT_NO_LONGER_AVAILABLE" } });
    await expect(gate.execute({ ...context, turnSequence: 6 }, confirmed))
      .resolves.toMatchObject({ ok: false, error: { code: "CONFIRMATION_MISMATCH" } });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
