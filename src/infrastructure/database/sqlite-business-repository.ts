import type { DatabaseSync } from "node:sqlite";
import type { BusinessProfile, BusinessRepository } from "../../modules/business/index.js";
import type { RegionId, TenantId } from "../../shared/types/identifiers.js";

type ProfileRow = { profile_json: string };

export class SqliteBusinessRepository implements BusinessRepository {
  constructor(private readonly database: DatabaseSync, private readonly region: RegionId) {}

  async findByTenantId(tenantId: TenantId): Promise<BusinessProfile | null> {
    const row = this.database.prepare(
      "SELECT profile_json FROM businesses WHERE region_id = ? AND tenant_id = ?",
    ).get(this.region, tenantId) as ProfileRow | undefined;
    return row ? JSON.parse(row.profile_json) as BusinessProfile : null;
  }

  async findByCalledNumber(calledNumber: string): Promise<BusinessProfile | null> {
    const row = this.database.prepare(`
      SELECT b.profile_json
      FROM called_numbers n
      JOIN businesses b ON b.region_id = n.region_id AND b.tenant_id = n.tenant_id
      WHERE n.region_id = ? AND n.phone = ?
    `).get(this.region, calledNumber) as ProfileRow | undefined;
    return row ? JSON.parse(row.profile_json) as BusinessProfile : null;
  }

  async save(profile: BusinessProfile): Promise<void> {
    const result = this.database.prepare(`
      UPDATE businesses
      SET business_id = ?, profile_json = ?
      WHERE region_id = ? AND tenant_id = ?
    `).run(profile.businessId, JSON.stringify(profile), this.region, profile.tenantId);
    if (result.changes === 0) {
      this.database.prepare(`
        INSERT INTO businesses(region_id, tenant_id, business_id, profile_json)
        VALUES (?, ?, ?, ?)
      `).run(this.region, profile.tenantId, profile.businessId, JSON.stringify(profile));
    }
  }
}
