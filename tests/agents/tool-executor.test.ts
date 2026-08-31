import { describe, expect, it, vi } from "vitest";
import { success } from "../../src/shared/domain/result.js";
import type { Appointment, AppointmentService } from "../../src/modules/appointments/index.js";
import type { SchedulingService } from "../../src/modules/scheduling/index.js";
import type { CustomerService } from "../../src/modules/customers/index.js";
import { BusinessDirectoryService, InMemoryBusinessRepository, type BusinessProfile } from "../../src/modules/business/index.js";
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
  const updateCustomer = vi.fn(async () => success({ id: "customer-1", tenantId: "tenant-a", name: "John Smith", phone: "9155551234" }));
  const customers = { updateCustomer, findOrCreateByPhone: vi.fn() } as unknown as CustomerService;
  const businesses = new BusinessDirectoryService(new InMemoryBusinessRepository([business]));
  return {
    appointments,
    createAppointment,
    cancelAppointment,
    findAvailableSlots,
    getAppointment,
    updateCustomer,
    transferToConfiguredDestination,
    executor: new ToolExecutorImpl(scheduling, appointments, transfer, businesses, undefined, customers),
  };
}

const context = { tenantId: "tenant-a", callId: "call-1", customerId: "customer-1" };
const business: BusinessProfile = {
  region: "US", tenantId: "tenant-a", businessId: "business-a", name: "YIBO Dental", timezone: "America/Denver", locale: "en-US", active: true,
  calledNumbers: ["+19155550123"], employees: [{ id: "employee-1", displayName: "Dr. Alex", active: true }],
  services: [
    { id: "service-1", name: "Consultation", durationMinutes: 30, bufferMinutes: 0, eligibleEmployeeIds: ["employee-1"] },
    { id: "cleaning-1", name: "Cleaning", durationMinutes: 45, bufferMinutes: 0, eligibleEmployeeIds: ["employee-1"] },
  ],
  openingHours: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
};

describe("ToolExecutorImpl", () => {
  it("uses the trusted tenant when checking availability", async () => {
    const { executor, findAvailableSlots } = fixture();
    const result = await executor.execute(context, {
      toolCallId: "tool-1",
      name: "check_availability",
      arguments: {
        service: "Consultation",
        rangeStart: "2026-08-10T00:00:00.000Z",
        rangeEnd: "2026-08-11T00:00:00.000Z",
      },
    });

    expect(result.ok).toBe(true);
    expect(findAvailableSlots).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a" }));
  });

  it("automatically selects the clinic default service for a natural date and returns the earliest slot", async () => {
    const { findAvailableSlots } = fixture();
    // The production executor receives the business directory and clock from bootstrap.
    const scheduling = { findAvailableSlots, validateSlot: vi.fn() } as unknown as SchedulingService;
    const datedExecutor = new ToolExecutorImpl(
      scheduling,
      {} as AppointmentService,
      { transferToConfiguredDestination: vi.fn() },
      new BusinessDirectoryService(new InMemoryBusinessRepository([business])),
      { now: () => new Date("2026-08-30T18:00:00.000Z") },
    );
    const result = await datedExecutor.execute(context, {
      toolCallId: "tool-date", name: "check_availability", arguments: { dateExpression: "this week" },
    });

    expect(findAvailableSlots).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: "service-1",
      rangeStart: "2026-08-31T06:00:00.000Z", rangeEnd: "2026-09-07T06:00:00.000Z",
    }));
    expect(result).toMatchObject({ ok: true, data: { earliestSlot: { startAt: "2026-08-10T15:00:00.000Z" }, resolvedDate: "this week" } });
  });

  it("rejects model attempts to override trusted context", async () => {
    const { executor, findAvailableSlots } = fixture();
    const result = await executor.execute(context, {
      toolCallId: "tool-1",
      name: "check_availability",
      arguments: {
        tenantId: "tenant-b",
        service: "Consultation",
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
        service: "Consultation",
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
      arguments: { service: "Consultation", employeeId: "employee-1", startAt: "2026-08-10T15:00:00.000Z" },
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

  it("maps a patient-facing service and saves contact details without returning them", async () => {
    const { createAppointment, executor, updateCustomer } = fixture();
    const contactResult = await executor.execute(context, {
      toolCallId: "tool-contact", name: "update_customer", arguments: { name: "John Smith", phone: "915-555-1234" },
    });
    const appointmentResult = await executor.execute(context, {
      toolCallId: "tool-cleaning", name: "create_appointment", arguments: { service: "Cleaning", employeeId: "employee-1", startAt: "2026-08-10T15:00:00.000Z" },
    });

    expect(updateCustomer).toHaveBeenCalledWith({ tenantId: "tenant-a", customerId: "customer-1", name: "John Smith", phone: "915-555-1234" });
    expect(contactResult).toEqual({ toolCallId: "tool-contact", ok: true, data: { saved: true } });
    expect(JSON.stringify(contactResult)).not.toContain("John Smith");
    expect(JSON.stringify(contactResult)).not.toContain("915-555-1234");
    expect(createAppointment).toHaveBeenCalledWith(expect.objectContaining({ serviceId: "cleaning-1" }));
    expect(appointmentResult.ok).toBe(true);
  });

  it("requires a first and last name before saving customer details", async () => {
    const { executor, updateCustomer } = fixture();
    const result = await executor.execute(context, {
      toolCallId: "tool-contact", name: "update_customer", arguments: { name: "John", phone: "915-555-1234" },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_TOOL_ARGUMENTS" } });
    expect(updateCustomer).not.toHaveBeenCalled();
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
