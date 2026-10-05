import { randomUUID } from "node:crypto";
import type { EmployeeId, LocationId, TenantId } from "../../../shared/types/identifiers.js";
import type { AppointmentConcurrencyGuard, AppointmentLockClaim } from "../ports/appointment-dependencies.js";

export class InMemoryAppointmentConcurrencyGuard implements AppointmentConcurrencyGuard {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly claims = new Map<string, AppointmentLockClaim & { live: boolean }>();

  async execute<T>(tenantId: TenantId, locationId: LocationId, employeeId: EmployeeId, operation: () => Promise<T>): Promise<T> {
    // Location-wide serialization protects both the professional's capacity 1
    // and the shared location capacity when different professionals race.
    const key = `${tenantId}:${locationId}`;
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    const ownerId = randomUUID();
    this.tails.set(key, current);
    await previous;
    this.claims.set(key, { tenantId, locationId, ownerId, acquiredAt: new Date().toISOString(), live: true });
    try {
      return await operation();
    } finally {
      const claim = this.claims.get(key);
      if (claim?.ownerId === ownerId) this.claims.delete(key);
      release();
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }

  listClaims(tenantId: TenantId): AppointmentLockClaim[] {
    return [...this.claims.values()]
      .filter((claim) => claim.tenantId === tenantId)
      .map(({ tenantId: claimTenant, locationId, ownerId, acquiredAt }) => ({
        tenantId: claimTenant, locationId, ownerId, acquiredAt,
      }));
  }

  releaseClaim(tenantId: TenantId, locationId: LocationId, ownerId: string, acquiredAt: string): boolean {
    const key = `${tenantId}:${locationId}`;
    const claim = this.claims.get(key);
    // A live in-process claim is not a crash. Only an abandoned record can be cleared.
    if (!claim || claim.live || claim.ownerId !== ownerId || claim.acquiredAt !== acquiredAt) return false;
    this.claims.delete(key);
    return true;
  }
}
