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
    const execute = vi.fn<ToolExecutor["execute"]>();
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

  it("passes tools without a confirmation policy through unchanged", async () => {
    const execute = vi.fn<ToolExecutor["execute"]>(async (_context, call) => ({
      toolCallId: call.toolCallId, ok: true, data: { services: [] },
    }));
    const gate = new ConfirmationGateToolExecutor({ execute }, ["create_appointment"]);
    const call = { toolCallId: "read-1", name: "get_service_information" as const, arguments: {} };

    await expect(gate.execute(context, call)).resolves.toMatchObject({ ok: true });
    expect(execute).toHaveBeenCalledWith(context, call);
  });
});
