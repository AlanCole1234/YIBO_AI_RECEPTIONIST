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
  locationId: "default",
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
  const rescheduleAppointment = vi.fn(async () => success({ ...confirmedAppointment, startAt: "2026-08-11T21:00:00.000Z", endAt: "2026-08-11T21:30:00.000Z" }));
  const appointments = {
    createAppointment,
    getAppointment,
    cancelAppointment,
    rescheduleAppointment,
  } as unknown as AppointmentService;
  const transferToConfiguredDestination = vi.fn(async () => success(undefined));
  const transfer: HumanTransferPort = { transferToConfiguredDestination };
  const updateCustomer = vi.fn(async () => success({ id: "customer-1", tenantId: "tenant-a", name: "John Smith", phone: "9155551234" }));
  const customers = { updateCustomer, findOrCreateByPhone: vi.fn(async () => success({ id: "test-customer", tenantId: "tenant-a", name: "YIBO Test Patient", phone: "+15550000000" })) } as unknown as CustomerService;
  const businesses = new BusinessDirectoryService(new InMemoryBusinessRepository([business]));
  return {
    appointments,
    createAppointment,
    cancelAppointment,
    rescheduleAppointment,
    findAvailableSlots,
    getAppointment,
    updateCustomer,
    transferToConfiguredDestination,
    executor: new ToolExecutorImpl(scheduling, appointments, transfer, businesses, undefined, customers),
  };
}

const context = { tenantId: "tenant-a", locationId: "default", callId: "call-1", customerId: "customer-1" };
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
  it("allows Developer Test Mode only from server-authorized local contexts", async () => {
    const { executor } = fixture();
    const denied = await executor.execute(context, { toolCallId: "test-denied", name: "enable_developer_test_mode", arguments: {} });
    const allowed = await executor.execute({ ...context, callId: "developer-call", developerTestModeAuthorized: true }, { toolCallId: "test-enabled", name: "enable_developer_test_mode", arguments: {} });

    expect(denied).toMatchObject({ ok: false, error: { code: "TEST_MODE_NOT_AUTHORIZED" } });
    expect(allowed).toMatchObject({ ok: true, data: { enabled: true } });
  });

  it("creates and deletes only appointments created during the authorized test session", async () => {
    const { executor, createAppointment, cancelAppointment } = fixture();
    const developerContext = { ...context, callId: "developer-call", developerTestModeAuthorized: true as const };

    await executor.execute(developerContext, { toolCallId: "enable-test", name: "enable_developer_test_mode", arguments: {} });
    await executor.execute(developerContext, {
      toolCallId: "create-test", name: "create_appointment",
      arguments: { service: "Consultation", employeeId: "employee-1", startAt: "2026-08-10T15:00:00.000Z" },
    });
    const deleted = await executor.execute(developerContext, { toolCallId: "delete-test", name: "delete_test_appointments", arguments: {} });

    expect(createAppointment).toHaveBeenCalledWith(expect.objectContaining({
      customerId: "test-customer", source: "DEVELOPER_TEST", sourceCallId: "developer-call",
    }));
    expect(deleted).toEqual({ toolCallId: "delete-test", ok: true, data: { deleted: 1 } });
    expect(cancelAppointment).toHaveBeenCalledWith({ tenantId: "tenant-a", locationId: "default", appointmentId: "appointment-1" });
  });

  it("cannot delete normal appointments through a public session", async () => {
    const { executor, cancelAppointment } = fixture();
    const result = await executor.execute(context, { toolCallId: "delete-public", name: "delete_test_appointments", arguments: {} });

    expect(result).toMatchObject({ ok: false, error: { code: "TEST_MODE_NOT_AUTHORIZED" } });
    expect(cancelAppointment).not.toHaveBeenCalled();
  });

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
    expect(findAvailableSlots).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-a", locationId: "default",
    }));
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
        locationId: "other-location",
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
      locationId: "default",
      customerId: "customer-1",
      serviceId: "service-1",
      employeeId: "employee-1",
      startAt: "2026-08-10T15:00:00.000Z",
      idempotencyKey: "call-1:tool-42",
      source: "AI_CALL",
      sourceCallId: "call-1",
    });
  });

  it("normalizes a caller's bare local time in the clinic timezone before booking", async () => {
    const { createAppointment, executor } = fixture();
    await executor.execute(context, {
      toolCallId: "tool-local-time",
      name: "create_appointment",
      arguments: { service: "Consultation", employeeId: "employee-1", startAt: "2026-08-10T15:00" },
    });

    expect(createAppointment).toHaveBeenCalledWith(expect.objectContaining({
      startAt: "2026-08-10T21:00:00.000Z",
    }));
  });

  it("books the verified 3:00 PM availability instant instead of a reconstructed 3:00 PM UTC value", async () => {
    const { appointments, createAppointment, findAvailableSlots } = fixture();
    const validateSlot = vi.fn(async (query: { startAt: string; employeeId: string }) => success({
      employeeId: query.employeeId,
      startAt: query.startAt,
      endAt: "2026-08-10T21:30:00.000Z",
      validatedAt: "2026-08-10T00:00:00.000Z",
    }));
    const executor = new ToolExecutorImpl(
      { findAvailableSlots, validateSlot } as unknown as SchedulingService,
      appointments,
      { transferToConfiguredDestination: vi.fn() },
      new BusinessDirectoryService(new InMemoryBusinessRepository([business])),
      { now: () => new Date("2026-08-10T12:00:00.000Z") },
    );

    await executor.execute(context, {
      toolCallId: "tool-check-3pm",
      name: "check_availability",
      arguments: {
        service: "Consultation", employeeId: "employee-1",
        rangeStart: "2026-08-10T00:00", rangeEnd: "2026-08-11T00:00",
        requestedStartAt: "2026-08-10T15:00",
      },
    });
    await executor.execute(context, {
      toolCallId: "tool-book-3pm",
      name: "create_appointment",
      // This simulates the original failure mode: the model incorrectly labels 3 PM as UTC.
      arguments: { service: "Consultation", employeeId: "employee-1", startAt: "2026-08-10T15:00:00.000Z" },
    });

    expect(createAppointment).toHaveBeenCalledWith(expect.objectContaining({
      startAt: "2026-08-10T21:00:00.000Z",
    }));
  });

  it("does not book a rebuilt UTC time that is not one of the available slots", async () => {
    const { appointments, createAppointment, executor, findAvailableSlots } = fixture();
    findAvailableSlots.mockResolvedValueOnce(success([{
      employeeId: "employee-1",
      startAt: "2026-08-10T21:00:00.000Z",
      endAt: "2026-08-10T21:30:00.000Z",
    }]));

    await executor.execute(context, {
      toolCallId: "tool-check-slots",
      name: "check_availability",
      arguments: {
        service: "Consultation", employeeId: "employee-1",
        rangeStart: "2026-08-10T00:00", rangeEnd: "2026-08-11T00:00",
      },
    });
    const result = await executor.execute(context, {
      toolCallId: "tool-book-rebuilt-utc",
      name: "create_appointment",
      // 3 PM local incorrectly rebuilt as 3 PM UTC would be 9 AM in Denver.
      arguments: { service: "Consultation", employeeId: "employee-1", startAt: "2026-08-10T15:00:00.000Z" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "SLOT_NOT_REVALIDATED" } });
    expect(createAppointment).not.toHaveBeenCalled();
    expect(appointments.createAppointment).not.toHaveBeenCalled();
  });

  it("does not create an appointment without a verified customer", async () => {
    const { createAppointment, executor } = fixture();
    const result = await executor.execute({ tenantId: "tenant-a", locationId: "default", callId: "call-1" }, {
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

  it("reschedules only an appointment owned by the verified caller using the clinic timezone", async () => {
    const { executor, rescheduleAppointment } = fixture();
    const result = await executor.execute(context, {
      toolCallId: "tool-reschedule", name: "reschedule_appointment",
      arguments: { appointmentId: "appointment-1", startAt: "2026-08-11T15:00" },
    });

    expect(rescheduleAppointment).toHaveBeenCalledWith({
      tenantId: "tenant-a", locationId: "default", appointmentId: "appointment-1", startAt: "2026-08-11T21:00:00.000Z",
    });
    expect(result).toMatchObject({ ok: true, data: { appointment: { id: "appointment-1", startAt: "2026-08-11T21:00:00.000Z" } } });
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
    expect(transferToConfiguredDestination).toHaveBeenCalledWith({ tenantId: "tenant-a", locationId: "default", callId: "call-1" });
  });
});
