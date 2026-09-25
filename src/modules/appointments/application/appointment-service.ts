import { operationalLog } from "../../../shared/observability/operational-log.js";
import { failure, success } from "../../../shared/domain/result.js";
import type { Clock } from "../../../shared/application/system.js";
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
  AppointmentCalendarQuery,
  AppointmentService,
  CancelAppointmentCommand,
  CancelAppointmentError,
  CreateAppointmentCommand,
  CreateAppointmentError,
  GetAppointmentQuery,
  ListUpcomingAppointmentsQuery,
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
    private readonly clock: Clock = { now: () => new Date() },
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
    const configuration = await this.businesses.getLocation(command.tenantId, command.locationId);
    if (!configuration.ok) return failure<CreateAppointmentError>({ code: "VALIDATION_ERROR", message: "Business is unavailable" });
    const offer = configuration.value.location.services.find((service) => service.serviceId === command.serviceId && service.active);
    if (!offer || !configuration.value.business.services.some((service) => service.id === command.serviceId && service.active)) {
      return failure<CreateAppointmentError>({ code: "SERVICE_NOT_FOUND" });
    }
    const assigned = configuration.value.location.professionals.some((professional) =>
      professional.professionalId === command.employeeId && professional.active && professional.serviceIds.includes(command.serviceId));
    if (!assigned || !configuration.value.business.professionals.some((employee) => employee.id === command.employeeId && employee.active)) {
      return failure<CreateAppointmentError>({ code: "EMPLOYEE_NOT_FOUND" });
    }
    const service = configuration.value.business.services.find((candidate) => candidate.id === command.serviceId)!;
    const customer = await this.customers.get(command.tenantId, command.customerId);

    return this.guard.execute(command.tenantId, command.locationId, command.employeeId, async () => {
      const raced = await this.repository.findByIdempotencyKey(command.tenantId, command.idempotencyKey);
      if (raced) {
        return sameRequest(raced, command) && raced.status === "CONFIRMED"
          ? success(raced)
          : failure<CreateAppointmentError>({ code: "IDEMPOTENCY_CONFLICT" });
      }

      const slot = await this.scheduling.validateSlot({
        tenantId: command.tenantId,
        locationId: command.locationId,
        serviceId: command.serviceId,
        employeeId: command.employeeId,
        startAt: command.startAt,
      });
      calendarLog("calendar.slot.recheck", { tenantId: command.tenantId, employeeId: command.employeeId, startAt: command.startAt, available: slot.ok });
      if (!slot.ok) return failure<CreateAppointmentError>(mapSchedulingError(slot.error));

      const pending: Appointment = {
        id: this.createId(),
        ...command,
        serviceNameSnapshot: service.name,
        priceAmountMinor: offer.price.amountMinor,
        priceCurrency: offer.price.currency,
        startAt: slot.value.startAt,
        endAt: slot.value.endAt,
        status: "PENDING_CONFIRMATION",
      };
      await this.repository.save(pending);

      calendarLog("calendar.trace.booking.service", {
        tenantId: pending.tenantId,
        locationId: pending.locationId,
        appointmentId: pending.id,
        startAt: pending.startAt,
        endAt: pending.endAt,
      });
      calendarLog("calendar.user.confirmed", { tenantId: pending.tenantId, appointmentId: pending.id });
      calendarLog("calendar.booking.started", { tenantId: pending.tenantId, appointmentId: pending.id, startAt: pending.startAt });
      const external = await this.calendar.createEvent({
        tenantId: pending.tenantId,
        locationId: pending.locationId,
        appointmentId: pending.id,
        employeeId: pending.employeeId,
        title: command.source === "DEVELOPER_TEST" ? "[YIBO TEST] Test Appointment" : `${service.name} appointment`,
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
    if (!appointment || appointment.locationId !== command.locationId) return failure<CancelAppointmentError>({ code: "APPOINTMENT_NOT_FOUND" });
    if (appointment.status === "CANCELLED") {
      return failure<CancelAppointmentError>({ code: "APPOINTMENT_ALREADY_CANCELLED" });
    }
    const cancellationPolicy = await this.businesses.getLocation(appointment.tenantId, appointment.locationId);
    if (!cancellationPolicy.ok || minutesUntil(appointment.startAt, this.clock.now())
      < cancellationPolicy.value.location.policies.minimumCancellationNoticeMinutes) {
      return failure<CancelAppointmentError>({ code: "CANCELLATION_NOTICE_NOT_MET" });
    }
    if (appointment.externalCalendarEventId) {
      const cancelled = await this.calendar.cancelEvent({
        appointmentId: appointment.id,
        tenantId: appointment.tenantId,
        locationId: appointment.locationId,
        employeeId: appointment.employeeId,
        externalEventId: appointment.externalCalendarEventId,
      });
      if (!cancelled.ok) return failure<CancelAppointmentError>(calendarFailure(cancelled.error));
    }
    const result: Appointment = { ...appointment, status: "CANCELLED" };
    await this.repository.save(result);
    return success(result);
  }

  async rescheduleAppointment(command: RescheduleAppointmentCommand) {
    if (!validDate(command.startAt)) {
      return failure<RescheduleAppointmentError>({ code: "VALIDATION_ERROR", message: "startAt must be a valid ISO datetime" });
    }
    const appointment = await this.repository.findById(command.tenantId, command.appointmentId);
    if (!appointment || appointment.locationId !== command.locationId) return failure<RescheduleAppointmentError>({ code: "APPOINTMENT_NOT_FOUND" });
    if (appointment.status !== "CONFIRMED" || !appointment.externalCalendarEventId) {
      return failure<RescheduleAppointmentError>({ code: "APPOINTMENT_NOT_CONFIRMED" });
    }
    const reschedulePolicy = await this.businesses.getLocation(appointment.tenantId, appointment.locationId);
    if (!reschedulePolicy.ok || minutesUntil(appointment.startAt, this.clock.now())
      < reschedulePolicy.value.location.policies.minimumRescheduleNoticeMinutes) {
      return failure<RescheduleAppointmentError>({ code: "RESCHEDULE_NOTICE_NOT_MET" });
    }

    return this.guard.execute(appointment.tenantId, appointment.locationId, appointment.employeeId, async () => {
      const slot = await this.scheduling.validateSlot({
        tenantId: appointment.tenantId,
        locationId: appointment.locationId,
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
        locationId: appointment.locationId,
        appointmentId: appointment.id,
        employeeId: appointment.employeeId,
        externalEventId: appointment.externalCalendarEventId!,
        startAt: slot.value.startAt,
        endAt: slot.value.endAt,
      });
      if (!moved.ok) return failure<RescheduleAppointmentError>(calendarFailure(moved.error));

      const updated: Appointment = {
        ...appointment,
        startAt: slot.value.startAt,
        endAt: slot.value.endAt,
        externalCalendarEventId: appointment.externalCalendarEventId,
      };
      await this.repository.save(updated);
      return success(updated);
    });
  }

  async getAppointment(query: GetAppointmentQuery) {
    const appointment = await this.repository.findById(query.tenantId, query.appointmentId);
    return appointment && appointment.locationId === query.locationId
      ? success(appointment)
      : failure<AppointmentLookupError>({ code: "APPOINTMENT_NOT_FOUND" });
  }

  listUpcomingAppointments(query: ListUpcomingAppointmentsQuery): Promise<Appointment[]> {
    return this.repository.findUpcomingByCustomer({
      ...query,
      startsAtOrAfter: this.clock.now().toISOString(),
    });
  }

  async listCalendarAppointments(query: AppointmentCalendarQuery) {
    const iso = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
    const validDay = (value: string) => {
      const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
      return Number.isFinite(day.valueOf()) && day.toISOString().slice(0, 10) === value.slice(0, 10);
    };
    const start = Date.parse(query.rangeStart), end = Date.parse(query.rangeEnd);
    if (!iso.test(query.rangeStart) || !iso.test(query.rangeEnd) || !validDay(query.rangeStart) || !validDay(query.rangeEnd) || !Number.isFinite(start)
      || !Number.isFinite(end) || end <= start || end - start > 31 * 86_400_000) {
      return failure({ code: "VALIDATION_ERROR" as const, message: "Choose a period of at most 31 days with explicit time zones." });
    }
    // Read configuration directly so inactive locations/professionals do not hide historical bookings.
    const context = await this.businesses.getBusinessConfiguration(query.tenantId);
    if (!context.ok || !context.value.configuration.locations.some(item => item.id === query.locationId)) {
      return failure({ code: "VALIDATION_ERROR" as const, message: "Location is unavailable." });
    }
    const appointments = await this.repository.findInRange({
      ...query, rangeStart: new Date(start).toISOString(), rangeEnd: new Date(end).toISOString(),
    });
    const customers = new Map<string, Awaited<ReturnType<CustomerReader["get"]>>>();
    for (const customerId of new Set(appointments.map(item => item.customerId))) {
      customers.set(customerId, await this.customers.get(query.tenantId, customerId));
    }
    return success(appointments.map(item => {
      const customer = customers.get(item.customerId);
      return {
        ...item,
        ...(customer?.name ? { customerName: customer.name } : {}),
        ...(customer ? { customerPhone: customer.phone } : {}),
        professionalName: context.value.configuration.professionals.find(person => person.id === item.employeeId)?.displayName
          ?? "Unlisted professional",
      };
    }));
  }
}

const validateCreate = (command: CreateAppointmentCommand): string | null => {
  if (!command.tenantId || !command.locationId || !command.customerId || !command.serviceId || !command.employeeId || !command.idempotencyKey) {
    return "Required identifiers must not be empty";
  }
  return validDate(command.startAt) ? null : "startAt must be a valid ISO datetime";
};

const validDate = (value: string): boolean => !Number.isNaN(new Date(value).valueOf());
const minutesUntil = (value: string, now: Date): number => (new Date(value).valueOf() - now.valueOf()) / 60_000;

const sameRequest = (appointment: Appointment, command: CreateAppointmentCommand): boolean =>
  appointment.customerId === command.customerId &&
  appointment.locationId === command.locationId &&
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

const calendarLog = operationalLog;
