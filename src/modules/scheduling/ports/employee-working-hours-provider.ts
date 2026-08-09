import type { EmployeeId, TenantId } from "../../../shared/types/identifiers.js";
import type { OpeningHoursRule } from "../../business/index.js";

export interface EmployeeWorkingHoursProvider {
  getWorkingHours(query: EmployeeWorkingHoursQuery): Promise<OpeningHoursRule[]>;
}

export interface EmployeeWorkingHoursQuery {
  tenantId: TenantId;
  employeeId: EmployeeId;
}
