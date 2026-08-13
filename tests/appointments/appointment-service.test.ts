import { describe, expect, it } from "vitest";
import { failure, success } from "../../src/shared/domain/result.js";
import {
  BusinessDirectoryService,
  InMemoryBusinessRepository,
  type BusinessProfile,
} from "../../src/modules/business/index.js";
import type { SchedulingService } from "../../src/modules/scheduling/index.js";
import {
  AppointmentServiceImpl,
  InMemoryAppointmentCalendar,
  InMemoryAppointmentConcurrencyGuard,
  InMemoryAppointmentRepository,
  type CustomerReader,
} from "../../src/modules/appointments/index.js";

const business: BusinessProfile = {
  region: "MX",
  tenantId: "tenant-a",
  businessId: "business-a",
  name: "YIBO Test Business",
  timezone: "America/Mexico_City",
  locale: "es-MX",
  active: true,
  calledNumbers: ["+525555555555"],
  services: [{
    id: "service-1",
    name: "Consultation",
    durationMinutes: 30,
    bufferMinutes: 0,
    eligibleEmployeeIds: ["employee-1"],
  }],
  employees: [{ id: "employee-1", displayName: "Ana", active: true }],
  openingHours: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
};

const customers: CustomerReader = {
  exists: async (tenantId, customerId) => tenantId === "tenant-a" && customerId === "customer-1",
};

const scheduling = (validate: SchedulingService["validateSlot"] = async (query) => success({
  employeeId: query.employeeId,
  startAt: new Date(query.startAt).toISOString(),
  endAt: new Date(new Date(query.startAt).valueOf() + 30 * 60_000).toISOString(),
  validatedAt: "2026-08-09T12:00:00.000Z",
})): SchedulingService => ({
  findAvailableSlots: async () => success([]),
  validateSlot: validate,
});

const command = {
  tenantId: "tenant-a",
  customerId: "customer-1",
  serviceId: "service-1",
  employeeId: "employee-1",
  startAt: "2026-08-10T15:00:00.000Z",
  idempotencyKey: "request-1",
  source: "AI_CALL" as const,
  sourceCallId: "call-1",
};

function fixture(options: { scheduling?: SchedulingService } = {}) {
  const repository = new InMemoryAppointmentRepository();
  const calendar = new InMemoryAppointmentCalendar();
  let nextId = 1;
  const service = new AppointmentServiceImpl(
    repository,
    customers,
    new BusinessDirectoryService(new InMemoryBusinessRepository([business])),
    options.scheduling ?? scheduling(),
    calendar,
    new InMemoryAppointmentConcurrencyGuard(),
    () => `appointment-${nextId++}`,
  );
  return { calendar, repository, service };
}

describe("AppointmentServiceImpl", () => {
  it("revalidates the slot and confirms only after the external event succeeds", async () => {
    const { service } = fixture();

    const result = await service.createAppointment(command);

    expect(result).toEqual({ ok: true, value: {
      id: "appointment-1",
      ...command,
      startAt: "2026-08-10T15:00:00.000Z",
      endAt: "2026-08-10T15:30:00.000Z",
      status: "CONFIRMED",
      externalCalendarEventId: "event-1",
    } });
  });

  it("returns the previous result for a semantically identical idempotent retry", async () => {
    const { service } = fixture();
    const first = await service.createAppointment(command);
    const retry = await service.createAppointment(command);

    expect(first.ok).toBe(true);
    expect(retry).toEqual(first);
  });

  it("rejects reuse of an idempotency key for a different request", async () => {
    const { service } = fixture();
    await service.createAppointment(command);

    await expect(service.createAppointment({
      ...command,
      startAt: "2026-08-10T16:00:00.000Z",
    })).resolves.toEqual({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("marks the local appointment failed when calendar creation fails", async () => {
    const { calendar, service } = fixture();
    calendar.failNext({ code: "PROVIDER_UNAVAILABLE", retryable: true });

    const result = await service.createAppointment(command);
    const stored = await service.getAppointment({ tenantId: "tenant-a", appointmentId: "appointment-1" });

    expect(result).toEqual({ ok: false, error: { code: "CALENDAR_SYNC_FAILED", retryable: true } });
    expect(stored.ok && stored.value.status).toBe("FAILED");
  });

  it("never returns an appointment through another tenant", async () => {
    const { service } = fixture();
    await service.createAppointment(command);

    await expect(service.getAppointment({
      tenantId: "tenant-b",
      appointmentId: "appointment-1",
    })).resolves.toEqual({ ok: false, error: { code: "APPOINTMENT_NOT_FOUND" } });
  });

  it("serializes concurrent attempts so only one can claim a slot", async () => {
    let validations = 0;
    let activeValidations = 0;
    let maximumConcurrency = 0;
    const guardedScheduling = scheduling(async (query) => {
      activeValidations += 1;
      maximumConcurrency = Math.max(maximumConcurrency, activeValidations);
      await Promise.resolve();
      activeValidations -= 1;
      validations += 1;
      if (validations > 1) return failure({ code: "SLOT_CONFLICT" as const });
      return success({
        employeeId: query.employeeId,
        startAt: query.startAt,
        endAt: "2026-08-10T15:30:00.000Z",
        validatedAt: "2026-08-09T12:00:00.000Z",
      });
    });
    const { service } = fixture({ scheduling: guardedScheduling });

    const results = await Promise.all([
      service.createAppointment(command),
      service.createAppointment({ ...command, customerId: "customer-1", idempotencyKey: "request-2" }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, error: { code: "SLOT_NO_LONGER_AVAILABLE" } },
    ]);
    expect(maximumConcurrency).toBe(1);
  });

  it("cancels the external event before marking an appointment cancelled", async () => {
    const { service } = fixture();
    await service.createAppointment(command);

    const cancelled = await service.cancelAppointment({
      tenantId: "tenant-a",
      appointmentId: "appointment-1",
    });

    expect(cancelled.ok && cancelled.value.status).toBe("CANCELLED");
  });

  it("replaces the external event and persists the validated rescheduled slot", async () => {
    const { service } = fixture();
    await service.createAppointment(command);

    const rescheduled = await service.rescheduleAppointment({
      tenantId: "tenant-a",
      appointmentId: "appointment-1",
      startAt: "2026-08-10T16:00:00.000Z",
    });

    expect(rescheduled).toMatchObject({ ok: true, value: {
      id: "appointment-1",
      startAt: "2026-08-10T16:00:00.000Z",
      endAt: "2026-08-10T16:30:00.000Z",
      status: "CONFIRMED",
      externalCalendarEventId: "event-2",
    } });
  });
});
