import type {
  AdminIdentity,
  AdminIdentityRepository,
} from "../ports/admin-identity-repository.js";

export class InMemoryAdminIdentityRepository implements AdminIdentityRepository {
  private readonly identities = new Map<string, AdminIdentity>();

  async findByEmail(tenantId: string, normalizedEmail: string): Promise<AdminIdentity | null> {
    const value = this.identities.get(`${tenantId}:${normalizedEmail}`);
    return value ? structuredClone(value) : null;
  }

  async save(identity: AdminIdentity): Promise<void> {
    this.identities.set(`${identity.tenantId}:${identity.email}`, structuredClone(identity));
  }
}
