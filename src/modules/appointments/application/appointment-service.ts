import { failure, success } from "../../../shared/domain/result.js";
import type { BusinessDirectory } from "../../business/index.js";
import type { SchedulingError, SchedulingService } from "../../scheduling/index.js";
import type { Appointment } from "../domain/appointment.js";
import type {
  AppointmentCalendarError,
  AppointmentCalendarPort,
  AppointmentConcurrencyGuard,
  CustomerReader,
} from "../ports/appointment-dependencies.js";
import type { AppointmentRepository } from "../ports/appointment-repository.js";
import type {
  AppointmentLookupError,
  AppointmentService,
  CancelAppointmentCommand,
  CancelAppointmentError,
  CreateAppointmentCommand,
  CreateAppointmentError,
  GetAppointmentQuery,
  RescheduleAppointmentCommand,
  RescheduleAppointmentError,
} from "./contracts.js";

export class AppointmentServiceImpl implements AppointmentService {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly customers: CustomerReader,
    private readonly businesses: BusinessDirectory,
    private readonly scheduling: SchedulingService,
    private readonly calendar: AppointmentCalendarPort,
    private readonly guard: AppointmentConcurrencyGuard,
    private readonly createId: () => string,
  ) {}

  async createAppointment(command: CreateAppointmentCommand) {
    const invalid = validateCreate(command);
    if (invalid) return failure<CreateAppointmentError>({ code: "VALIDATION_ERROR", message: invalid });

    const previous = await this.repository.findByIdempotencyKey(command.tenantId, command.idempotencyKey);
    if (previous) {
      return sameRequest(previous, command) && previous.status === "CONFIRMED"
        ? success(previous)
        : failure<CreateAppointmentError>({ code: "IDEMPOTENCY_CONFLICT" });
    }

    if (!await this.customers.exists(command.tenantId, command.customerId)) {
      return failure<CreateAppointmentError>({ code: "CUSTOMER_NOT_FOUND" });
    }
    const configuration = await this.businesses.getBusinessProfile(command.tenantId);
    if (!configuration.ok) return failure<CreateAppointmentError>({ code: "VALIDATION_ERROR", message: "Business is unavailable" });
    if (!configuration.value.services.some((service) => service.id === command.serviceId)) {
      return failure<CreateAppointmentError>({ code: "SERVICE_NOT_FOUND" });
    }
    if (!configuration.value.employees.some((employee) => employee.id === command.employeeId && employee.active)) {
      return failure<CreateAppointmentError>({ code: "EMPLOYEE_NOT_FOUND" });
    }
    const service = configuration.value.services.find((candidate) => candidate.id === command.serviceId)!;
    const customer = await this.customers.get(command.tenantId, command.customerId);

    return this.guard.execute(command.tenantId, command.employeeId, async () => {
      const raced = await this.repository.findByIdempotencyKey(command.tenantId, command.idempotencyKey);
      if (raced) {
        return sameRequest(raced, command) && raced.status === "CONFIRMED"
          ? success(raced)
          : failure<CreateAppointmentError>({ code: "IDEMPOTENCY_CONFLICT" });
      }

      const slot = await this.scheduling.validateSlot({
        tenantId: command.tenantId,
        serviceId: command.serviceId,
        employeeId: command.employeeId,
        startAt: command.startAt,
      });
      calendarLog("calendar.slot.recheck", { tenantId: command.tenantId, employeeId: command.employeeId, startAt: command.startAt, available: slot.ok });
      if (!slot.ok) return failure<CreateAppointmentError>(mapSchedulingError(slot.error));

      const pending: Appointment = {
        id: this.createId(),
        ...command,
        startAt: slot.value.startAt,
        endAt: slot.value.endAt,
        status: "PENDING_CONFIRMATION",
      };
      await this.repository.save(pending);

      calendarLog("calendar.trace.booking.service", {
        tenantId: pending.tenantId,
        appointmentId: pending.id,
        startAt: pending.startAt,
        endAt: pending.endAt,
      });
      calendarLog("calendar.user.confirmed", { tenantId: pending.tenantId, appointmentId: pending.id });
      calendarLog("calendar.booking.started", { tenantId: pending.tenantId, appointmentId: pending.id, startAt: pending.startAt });
      const external = await this.calendar.createEvent({
        tenantId: pending.tenantId,
        appointmentId: pending.id,
        employeeId: pending.employeeId,
        title: `${service.name} appointment`,
        serviceName: service.name,
        ...(customer ? { patient: customer } : {}),
        startAt: pending.startAt,
        endAt: pending.endAt,
        idempotencyKey: pending.idempotencyKey,
      });
      if (!external.ok) {
        calendarLog("calendar.booking.failed", { tenantId: pending.tenantId, appointmentId: pending.id, code: external.error.code });
        await this.repository.save({ ...pending, status: "FAILED" });
        return failure<CreateAppointmentError>(calendarFailure(external.error));
      }

      const confirmed: Appointment = {
        ...pending,
        status: "CONFIRMED",
        externalCalendarEventId: external.value.externalEventId,
      };
      await this.repository.save(confirmed);
      calendarLog("calendar.booking.completed", { tenantId: confirmed.tenantId, appointmentId: confirmed.id, externalEventId: confirmed.externalCalendarEventId });
      return success(confirmed);
    });
  }

  async cancelAppointment(command: CancelAppointmentCommand) {
    const appointment = await this.repository.findById(command.tenantId, command.appointmentId);
    if (!appointment) return failure<CancelAppointmentError>({ code: "APPOINTMENT_NOT_FOUND" });
    return this.guard.execute(appointment.tenantId, appointment.employeeId, async () => {
      const current = await this.repository.findById(command.tenantId, command.appointmentId);
      if (!current) return failure<CancelAppointmentError>({ code: "APPOINTMENT_NOT_FOUND" });
      if (current.status === "CANCELLED") return failure<CancelAppointmentError>({ code: "APPOINTMENT_ALREADY_CANCELLED" });
      if (current.externalCalendarEventId) {
        const cancelled = await this.calendar.cancelEvent({
          tenantId: current.tenantId, appointmentId: current.id, externalEventId: current.externalCalendarEventId,
        });
        if (!cancelled.ok) return failure<CancelAppointmentError>(calendarFailure(cancelled.error));
      }
      const result: Appointment = { ...current, status: "CANCELLED" };
      await this.repository.save(result);
      return success(result);
    });
  }

  async rescheduleAppointment(command: RescheduleAppointmentCommand) {
    if (!validDate(command.startAt)) {
      return failure<RescheduleAppointmentError>({ code: "VALIDATION_ERROR", message: "startAt must be a valid ISO datetime" });
    }
    const appointment = await this.repository.findById(command.tenantId, command.appointmentId);
    if (!appointment) return failure<RescheduleAppointmentError>({ code: "APPOINTMENT_NOT_FOUND" });
    if (appointment.status !== "CONFIRMED" || !appointment.externalCalendarEventId) {
      return failure<RescheduleAppointmentError>({ code: "APPOINTMENT_NOT_CONFIRMED" });
    }

    return this.guard.execute(appointment.tenantId, appointment.employeeId, async () => {
      // Re-read after taking the existing guard: a preceding reschedule/cancel
      // may have changed this appointment while this request was waiting.
      const appointment = await this.repository.findById(command.tenantId, command.appointmentId);
      if (!appointment) return failure<RescheduleAppointmentError>({ code: "APPOINTMENT_NOT_FOUND" });
      if (appointment.status !== "CONFIRMED" || !appointment.externalCalendarEventId) {
        return failure<RescheduleAppointmentError>({ code: "APPOINTMENT_NOT_CONFIRMED" });
      }
      if (appointment.startAt === new Date(command.startAt).toISOString()) return success(appointment);
      const slot = await this.scheduling.validateSlot({
        tenantId: appointment.tenantId,
        serviceId: appointment.serviceId,
        employeeId: appointment.employeeId,
        startAt: command.startAt,
      });
      if (!slot.ok) {
        const mapped = mapSchedulingError(slot.error);
        return failure<RescheduleAppointmentError>(
          mapped.code === "CALENDAR_SYNC_FAILED" ? mapped : { code: "SLOT_NO_LONGER_AVAILABLE" },
        );
      }

      const moved = await this.calendar.rescheduleEvent({
        tenantId: appointment.tenantId,
        appointmentId: appointment.id,
        externalEventId: appointment.externalCalendarEventId,
        startAt: slot.value.startAt,
        endAt: slot.value.endAt,
      });
      if (!moved.ok) return failure<RescheduleAppointmentError>(calendarFailure(moved.error));

      const updated: Appointment = {
        ...appointment,
        startAt: slot.value.startAt,
        endAt: slot.value.endAt,
      };
      await this.repository.save(updated);
      return success(updated);
    });
  }

  async getAppointment(query: GetAppointmentQuery) {
    const appointment = await this.repository.findById(query.tenantId, query.appointmentId);
    return appointment
      ? success(appointment)
      : failure<AppointmentLookupError>({ code: "APPOINTMENT_NOT_FOUND" });
  }
}

const validateCreate = (command: CreateAppointmentCommand): string | null => {
  if (!command.tenantId || !command.customerId || !command.serviceId || !command.employeeId || !command.idempotencyKey) {
    return "Required identifiers must not be empty";
  }
  return validDate(command.startAt) ? null : "startAt must be a valid ISO datetime";
};

const validDate = (value: string): boolean => !Number.isNaN(new Date(value).valueOf());

const sameRequest = (appointment: Appointment, command: CreateAppointmentCommand): boolean =>
  appointment.customerId === command.customerId &&
  appointment.serviceId === command.serviceId &&
  appointment.employeeId === command.employeeId &&
  appointment.startAt === new Date(command.startAt).toISOString();

const mapSchedulingError = (error: SchedulingError): CreateAppointmentError => {
  if (error.code === "SERVICE_NOT_FOUND") return { code: "SERVICE_NOT_FOUND" };
  if (error.code === "EMPLOYEE_NOT_FOUND") return { code: "EMPLOYEE_NOT_FOUND" };
  if (error.code === "EXTERNAL_CALENDAR_UNAVAILABLE") {
    return { code: "CALENDAR_SYNC_FAILED", retryable: error.retryable };
  }
  if (error.code === "INVALID_TIME_RANGE") return { code: "VALIDATION_ERROR", message: "Invalid appointment time" };
  return { code: "SLOT_NO_LONGER_AVAILABLE" };
};

const calendarFailure = (error: AppointmentCalendarError) => ({
  code: "CALENDAR_SYNC_FAILED" as const,
  retryable: error.code === "PROVIDER_UNAVAILABLE" ? error.retryable : error.code === "RATE_LIMITED",
});

const calendarLog = (event: string, metadata: Record<string, unknown>): void => console.log(JSON.stringify({ event, ...metadata }));
