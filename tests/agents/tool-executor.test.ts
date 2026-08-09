import { describe, expect, it, vi } from "vitest";
import { success } from "../../src/shared/domain/result.js";
import type { Appointment, AppointmentService } from "../../src/modules/appointments/index.js";
import type { SchedulingService } from "../../src/modules/scheduling/index.js";
import {
  ToolExecutorImpl,
  type HumanTransferPort,
} from "../../src/modules/agents/index.js";

const confirmedAppointment: Appointment = {
  id: "appointment-1",
  tenantId: "tenant-a",
  customerId: "customer-1",
  serviceId: "service-1",
  employeeId: "employee-1",
  startAt: "2026-08-10T15:00:00.000Z",
  endAt: "2026-08-10T15:30:00.000Z",
  status: "CONFIRMED",
  idempotencyKey: "call-1:tool-1",
  source: "AI_CALL",
  sourceCallId: "call-1",
  externalCalendarEventId: "event-1",
};

function fixture() {
  const findAvailableSlots = vi.fn(async () => success([{
    employeeId: "employee-1",
    startAt: "2026-08-10T15:00:00.000Z",
    endAt: "2026-08-10T15:30:00.000Z",
  }]));
  const scheduling = {
    findAvailableSlots,
    validateSlot: vi.fn(),
  } as unknown as SchedulingService;
  const createAppointment = vi.fn(async () => success(confirmedAppointment));
  const getAppointment = vi.fn(async () => success(confirmedAppointment));
  const cancelAppointment = vi.fn(async () => success({ ...confirmedAppointment, status: "CANCELLED" as const }));
  const appointments = {
    createAppointment,
    getAppointment,
    cancelAppointment,
    rescheduleAppointment: vi.fn(),
  } as unknown as AppointmentService;
  const transferToConfiguredDestination = vi.fn(async () => success(undefined));
  const transfer: HumanTransferPort = { transferToConfiguredDestination };
  return {
    appointments,
    createAppointment,
    cancelAppointment,
    findAvailableSlots,
    getAppointment,
    transferToConfiguredDestination,
    executor: new ToolExecutorImpl(scheduling, appointments, transfer),
  };
}

const context = { tenantId: "tenant-a", callId: "call-1", customerId: "customer-1" };

describe("ToolExecutorImpl", () => {
  it("uses the trusted tenant when checking availability", async () => {
    const { executor, findAvailableSlots } = fixture();
    const result = await executor.execute(context, {
      toolCallId: "tool-1",
      name: "check_availability",
      arguments: {
        serviceId: "service-1",
        rangeStart: "2026-08-10T00:00:00.000Z",
        rangeEnd: "2026-08-11T00:00:00.000Z",
      },
    });

    expect(result.ok).toBe(true);
    expect(findAvailableSlots).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a" }));
  });

  it("rejects model attempts to override trusted context", async () => {
    const { executor, findAvailableSlots } = fixture();
    const result = await executor.execute(context, {
      toolCallId: "tool-1",
      name: "check_availability",
      arguments: {
        tenantId: "tenant-b",
        serviceId: "service-1",
        rangeStart: "2026-08-10T00:00:00.000Z",
        rangeEnd: "2026-08-11T00:00:00.000Z",
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_TOOL_ARGUMENTS" } });
    expect(findAvailableSlots).not.toHaveBeenCalled();
  });

  it("builds appointment commands only from validated arguments and trusted session fields", async () => {
    const { createAppointment, executor } = fixture();
    const result = await executor.execute(context, {
      toolCallId: "tool-42",
      name: "create_appointment",
      arguments: {
        serviceId: "service-1",
        employeeId: "employee-1",
        startAt: "2026-08-10T15:00:00.000Z",
      },
    });

    expect(result.ok).toBe(true);
    expect(createAppointment).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      customerId: "customer-1",
      serviceId: "service-1",
      employeeId: "employee-1",
      startAt: "2026-08-10T15:00:00.000Z",
      idempotencyKey: "call-1:tool-42",
      source: "AI_CALL",
      sourceCallId: "call-1",
    });
  });

  it("does not create an appointment without a verified customer", async () => {
    const { createAppointment, executor } = fixture();
    const result = await executor.execute({ tenantId: "tenant-a", callId: "call-1" }, {
      toolCallId: "tool-1",
      name: "create_appointment",
      arguments: { serviceId: "service-1", employeeId: "employee-1", startAt: "2026-08-10T15:00:00.000Z" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "CUSTOMER_REQUIRED" } });
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it("verifies appointment ownership before cancellation", async () => {
    const { cancelAppointment, executor, getAppointment } = fixture();
    getAppointment.mockResolvedValueOnce(success({ ...confirmedAppointment, customerId: "customer-2" }));
    const result = await executor.execute(context, {
      toolCallId: "tool-1",
      name: "cancel_appointment",
      arguments: { appointmentId: "appointment-1" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "APPOINTMENT_NOT_FOUND" } });
    expect(cancelAppointment).not.toHaveBeenCalled();
  });

  it("does not accept an arbitrary transfer destination", async () => {
    const { executor, transferToConfiguredDestination } = fixture();
    const result = await executor.execute(context, {
      toolCallId: "tool-1",
      name: "transfer_to_human",
      arguments: { destination: "sip:attacker@example.com" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_TOOL_ARGUMENTS" } });
    expect(transferToConfiguredDestination).not.toHaveBeenCalled();
  });

  it("transfers using only the tenant-configured destination port", async () => {
    const { executor, transferToConfiguredDestination } = fixture();
    const result = await executor.execute(context, {
      toolCallId: "tool-1",
      name: "transfer_to_human",
      arguments: {},
    });

    expect(result).toEqual({ toolCallId: "tool-1", ok: true, data: { transferred: true } });
    expect(transferToConfiguredDestination).toHaveBeenCalledWith({ tenantId: "tenant-a", callId: "call-1" });
  });
});
