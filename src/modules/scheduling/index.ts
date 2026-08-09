export { SchedulingServiceImpl } from "./application/scheduling-service.js";
export type {
  AvailableSlot,
  FindAvailableSlotsQuery,
  SchedulingError,
  SchedulingService,
  ValidateSlotQuery,
  ValidatedSlot,
} from "./application/contracts.js";
export type { CalendarPort, BusyInterval, CalendarError } from "./ports/calendar-port.js";
export type { ConfirmedAppointmentReader, OccupiedInterval } from "./ports/confirmed-appointment-reader.js";
export type { EmployeeWorkingHoursProvider } from "./ports/employee-working-hours-provider.js";
