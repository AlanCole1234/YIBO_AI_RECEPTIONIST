import type { EmployeeId, TenantId } from "../../../shared/types/identifiers.js";

export interface ConfirmedAppointmentReader {
  findConfirmedIntervals(query: ConfirmedAppointmentQuery): Promise<OccupiedInterval[]>;
}

export interface ConfirmedAppointmentQuery {
  tenantId: TenantId;
  employeeId: EmployeeId;
  rangeStart: string;
  rangeEnd: string;
}

export interface OccupiedInterval {
  startAt: string;
  endAt: string;
}
