import { describe, expect, it } from "vitest";
import { buildApplication, type IdGenerator } from "../../src/bootstrap/index.js";
import {
  ScriptedConversationRuntime,
  type ToolResultEnvelope,
} from "../../src/modules/conversation/index.js";

const TENANT_ID = "tenant-yibo-demo";
const CALL_ID = "call-e2e-1";
const CUSTOMER_ID = "customer-e2e";
const APPOINTMENT_ID = "appointment-e2e";
const CHECK_TOOL_CALL_ID = "tool-check-1";
const CONFIRM_TOOL_CALL_ID = "tool-confirm-1";
const CREATE_TOOL_CALL_ID = "tool-create-1";

const noAudio = async function* () {};

describe("in-memory call to appointment", () => {
  it("survives 50 scheduling changes with real services and five separately confirmed bookings", async () => {
    const app = buildApplication({ clock: { now: () => new Date("2026-08-01T12:00:00Z") } });
    if (!(app.runtime instanceof ScriptedConversationRuntime)) throw new Error("Expected scripted transport boundary");
    app.registerCallMedia("long-call", { inboundAudio: noAudio(), outboundAudio: { write: async () => {} }, close: async () => {} });
    await app.calls.handleTelephonyEvent({ type: "INCOMING_CALL", callId: "long-call", from: "+529991234567", to: "+529991000000", occurredAt: "2026-08-10T14:00:00Z" });
    const runtime = app.runtime.latestSession;
    const bookedIds = new Set<string>();
    for (let turn = 0; turn < 50; turn++) {
      const day = 10 + turn % 5;
      const checkId = `check-${turn}`;
      runtime.emit({ type: "tool.call", toolCallId: checkId, name: "check_availability", arguments: { service: "Consultation", employeeId: "employee-1", rangeStart: `2026-08-${day}T00:00:00Z`, rangeEnd: `2026-08-${day + 1}T00:00:00Z` } });
      const available = await waitForToolResult(runtime.receivedToolResults, checkId);
      if (!available.ok) throw new Error(available.error.code);
      const slot = firstSlot(available.data);
      if (turn % 10 !== 9) continue;
      const confirmId = `confirm-${turn}`;
      runtime.emit({ type: "tool.call", toolCallId: confirmId, name: "confirm_appointment", arguments: { service: "Consultation", employeeId: slot.employeeId, startAt: slot.startAt } });
      expect(await waitForToolResult(runtime.receivedToolResults, confirmId)).toMatchObject({ ok: true });
      const bookId = `book-${turn}`;
      runtime.emit({ type: "tool.call", toolCallId: bookId, name: "create_appointment", arguments: { service: "Consultation", employeeId: slot.employeeId, startAt: slot.startAt } });
      const booked = await waitForToolResult(runtime.receivedToolResults, bookId);
      if (!booked.ok) throw new Error(booked.error.code);
      bookedIds.add(String(appointmentFrom(booked.data).id));
      const duplicateId = `duplicate-${turn}`;
      runtime.emit({ type: "tool.call", toolCallId: duplicateId, name: "create_appointment", arguments: { service: "Consultation", employeeId: slot.employeeId, startAt: slot.startAt } });
      expect(await waitForToolResult(runtime.receivedToolResults, duplicateId)).toMatchObject({ ok: false });
    }
    expect(bookedIds.size).toBe(5);
    const busy = await app.calendar.getBusyIntervals({ tenantId: TENANT_ID, employeeId: "employee-1", rangeStart: "2026-08-10T00:00:00Z", rangeEnd: "2026-08-15T00:00:00Z" });
    expect(busy.ok && busy.value).toHaveLength(5);
    await app.calls.handleTelephonyEvent({ type: "CALL_HUNG_UP", callId: "long-call", occurredAt: "2026-08-10T15:00:00Z" });
    expect(runtime.closeCount).toBe(1);
  });

  it("creates a confirmed appointment through calls, conversation and real application services", async () => {
    const ids: IdGenerator = {
      generate: (scope) => scope === "customer" ? CUSTOMER_ID : scope === "appointment" ? APPOINTMENT_ID : `${scope}-e2e`,
    };
    const app = buildApplication({ ids });
    if (!(app.runtime instanceof ScriptedConversationRuntime)) {
      throw new Error("The E2E scenario requires the in-memory scripted runtime");
    }

    let mediaCloseCount = 0;
    app.registerCallMedia(CALL_ID, {
      inboundAudio: noAudio(),
      outboundAudio: { write: async () => undefined },
      close: async () => { mediaCloseCount += 1; },
    });

    await app.calls.handleTelephonyEvent({
      type: "INCOMING_CALL",
      callId: CALL_ID,
      from: "+529991234567",
      to: "+529991000000",
      occurredAt: "2026-08-10T14:00:00.000Z",
    });

    expect(app.telephony.answeredCallIds).toEqual([CALL_ID]);
    expect(app.runtime.openedInputs).toHaveLength(1);
    const runtimeSession = app.runtime.latestSession;

    runtimeSession.emit({
      type: "tool.call",
      toolCallId: CHECK_TOOL_CALL_ID,
      name: "check_availability",
      arguments: {
        service: "Consultation",
        employeeId: "employee-1",
        rangeStart: "2026-08-10T00:00:00.000Z",
        rangeEnd: "2026-08-11T00:00:00.000Z",
      },
    });

    const availability = await waitForToolResult(runtimeSession.receivedToolResults, CHECK_TOOL_CALL_ID);
    if (!availability.ok) throw new Error(`Availability failed: ${availability.error.code}`);
    const selected = firstSlot(availability.data);

    runtimeSession.emit({
      type: "tool.call",
      toolCallId: CONFIRM_TOOL_CALL_ID,
      name: "confirm_appointment",
      arguments: {
        service: "Consultation",
        employeeId: selected.employeeId,
        startAt: selected.startAt,
      },
    });
    const confirmation = await waitForToolResult(runtimeSession.receivedToolResults, CONFIRM_TOOL_CALL_ID);
    if (!confirmation.ok) throw new Error(`Appointment confirmation failed: ${confirmation.error.code}`);

    runtimeSession.emit({
      type: "tool.call",
      toolCallId: CREATE_TOOL_CALL_ID,
      name: "create_appointment",
      arguments: {
        service: "Consultation",
        employeeId: selected.employeeId,
        startAt: selected.startAt,
      },
    });

    const creation = await waitForToolResult(runtimeSession.receivedToolResults, CREATE_TOOL_CALL_ID);
    if (!creation.ok) throw new Error(`Appointment creation failed: ${creation.error.code}`);
    const createdAppointment = appointmentFrom(creation.data);

    expect(createdAppointment).toMatchObject({
      id: APPOINTMENT_ID,
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      status: "CONFIRMED",
      idempotencyKey: `${CALL_ID}:${CREATE_TOOL_CALL_ID}`,
      source: "AI_CALL",
      sourceCallId: CALL_ID,
    });
    expect(createdAppointment.externalCalendarEventId).toBeTruthy();

    const persisted = await app.appointments.getAppointment({
      tenantId: TENANT_ID,
      appointmentId: APPOINTMENT_ID,
    });
    expect(persisted).toEqual({ ok: true, value: createdAppointment });

    const customer = await app.customers.findOrCreateByPhone({
      tenantId: TENANT_ID,
      phone: "+529991234567",
    });
    expect(customer).toMatchObject({ ok: true, value: { id: CUSTOMER_ID, tenantId: TENANT_ID } });

    const calendar = await app.calendar.getBusyIntervals({
      tenantId: TENANT_ID,
      employeeId: selected.employeeId,
      rangeStart: selected.startAt,
      rangeEnd: selected.endAt,
    });
    expect(calendar).toEqual({
      ok: true,
      value: [{ startAt: selected.startAt, endAt: selected.endAt }],
    });

    await app.calls.handleTelephonyEvent({
      type: "CALL_HUNG_UP",
      callId: CALL_ID,
      occurredAt: "2026-08-10T14:05:00.000Z",
    });
    await app.calls.handleTelephonyEvent({
      type: "CALL_HUNG_UP",
      callId: CALL_ID,
      occurredAt: "2026-08-10T14:06:00.000Z",
    });

    expect(runtimeSession.closeCount).toBe(1);
    expect(mediaCloseCount).toBe(1);
  });
});

async function waitForToolResult(
  results: ToolResultEnvelope[],
  toolCallId: string,
): Promise<ToolResultEnvelope> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = results.find((candidate) => candidate.toolCallId === toolCallId);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for tool result ${toolCallId}`);
}

function firstSlot(value: unknown): { employeeId: string; startAt: string; endAt: string } {
  if (!isRecord(value) || !Array.isArray(value.slots) || !isRecord(value.slots[0])) {
    throw new Error("Availability tool did not return a slot");
  }
  const slot = value.slots[0];
  if (typeof slot.employeeId !== "string" || typeof slot.startAt !== "string" || typeof slot.endAt !== "string") {
    throw new Error("Availability tool returned an invalid slot");
  }
  return { employeeId: slot.employeeId, startAt: slot.startAt, endAt: slot.endAt };
}

function appointmentFrom(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.appointment)) {
    throw new Error("Create appointment tool did not return an appointment");
  }
  return value.appointment;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
