import type { EmployeeId, TenantId } from "../../../shared/types/identifiers.js";
import type { AppointmentConcurrencyGuard } from "../ports/appointment-dependencies.js";

export class InMemoryAppointmentConcurrencyGuard implements AppointmentConcurrencyGuard {
  private readonly tails = new Map<string, Promise<void>>();

  async execute<T>(tenantId: TenantId, employeeId: EmployeeId, operation: () => Promise<T>): Promise<T> {
    const key = `${tenantId}:${employeeId}`;
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
