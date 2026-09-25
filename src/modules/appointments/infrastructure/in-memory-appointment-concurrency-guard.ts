import type { EmployeeId, LocationId, TenantId } from "../../../shared/types/identifiers.js";
import type { AppointmentConcurrencyGuard } from "../ports/appointment-dependencies.js";

export class InMemoryAppointmentConcurrencyGuard implements AppointmentConcurrencyGuard {
  private readonly tails = new Map<string, Promise<void>>();

  async execute<T>(tenantId: TenantId, locationId: LocationId, employeeId: EmployeeId, operation: () => Promise<T>): Promise<T> {
    // Location-wide serialization protects both the professional's capacity 1
    // and the shared location capacity when different professionals race.
    const key = `${tenantId}:${locationId}`;
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }
}
