import type { EmployeeId, LocationId, TenantId } from "../../../shared/types/identifiers.js";

export interface ConfirmedAppointmentReader {
  findConfirmedIntervals(query: ConfirmedAppointmentQuery): Promise<OccupiedInterval[]>;
}

export interface ConfirmedAppointmentQuery {
  tenantId: TenantId;
  locationId: LocationId;
  employeeId: EmployeeId;
  rangeStart: string;
  rangeEnd: string;
}

export interface OccupiedInterval {
  startAt: string;
  endAt: string;
}
