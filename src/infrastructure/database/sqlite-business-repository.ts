import type { DatabaseSync } from "node:sqlite";
import {
  upgradeBusinessProfile,
  type BusinessRepository,
  type VersionedBusinessProfile,
} from "../../modules/business/index.js";
import type { RegionId, TenantId } from "../../shared/types/identifiers.js";

type ProfileRow = { profile_json: string; configuration_version?: number };

export class SqliteBusinessRepository implements BusinessRepository {
  constructor(private readonly database: DatabaseSync, private readonly region: RegionId) {}

  async findByTenantId(tenantId: TenantId): Promise<VersionedBusinessProfile | null> {
    const row = this.database.prepare(
      "SELECT profile_json FROM businesses WHERE region_id = ? AND tenant_id = ?",
    ).get(this.region, tenantId) as ProfileRow | undefined;
    return row ? JSON.parse(row.profile_json) as VersionedBusinessProfile : null;
  }

  async findConfigurationByTenantId(tenantId: TenantId) {
    const row = this.database.prepare(
      "SELECT profile_json, configuration_version FROM businesses WHERE region_id = ? AND tenant_id = ?",
    ).get(this.region, tenantId) as ProfileRow | undefined;
    return row
      ? { profile: JSON.parse(row.profile_json) as VersionedBusinessProfile, version: row.configuration_version ?? 1 }
      : null;
  }

  async findByCalledNumber(calledNumber: string): Promise<VersionedBusinessProfile | null> {
    const row = this.database.prepare(`
      SELECT b.profile_json
      FROM called_numbers n
      JOIN businesses b ON b.region_id = n.region_id AND b.tenant_id = n.tenant_id
      WHERE n.region_id = ? AND n.phone = ?
    `).get(this.region, calledNumber) as ProfileRow | undefined;
    return row ? JSON.parse(row.profile_json) as VersionedBusinessProfile : null;
  }

  async save(profile: VersionedBusinessProfile): Promise<void> {
    const canonical = upgradeBusinessProfile(profile);
    this.inTransaction(() => {
      const existing = this.database.prepare(`SELECT configuration_version FROM businesses
        WHERE region_id = ? AND tenant_id = ?`).get(this.region, canonical.tenantId) as { configuration_version: number } | undefined;
      if (existing) {
        this.database.prepare(`UPDATE businesses SET business_id = ?, profile_json = ?,
          configuration_version = configuration_version + 1 WHERE region_id = ? AND tenant_id = ?`
        ).run(canonical.businessId, JSON.stringify(canonical), this.region, canonical.tenantId);
      } else {
        this.database.prepare(`INSERT INTO businesses(region_id, tenant_id, business_id, profile_json, configuration_version)
          VALUES (?, ?, ?, ?, 1)`
        ).run(this.region, canonical.tenantId, canonical.businessId, JSON.stringify(canonical));
      }
      this.syncCalledNumbers(canonical);
    });
  }

  async saveIfVersion(profile: VersionedBusinessProfile, expectedVersion: number) {
    const canonical = upgradeBusinessProfile(profile);
    return this.inTransaction(() => {
      const result = this.database.prepare(`UPDATE businesses SET business_id = ?, profile_json = ?,
        configuration_version = configuration_version + 1
        WHERE region_id = ? AND tenant_id = ? AND configuration_version = ?`
      ).run(canonical.businessId, JSON.stringify(canonical), this.region, canonical.tenantId, expectedVersion);
      if (Number(result.changes) === 0) {
        const row = this.database.prepare(`SELECT configuration_version FROM businesses
          WHERE region_id = ? AND tenant_id = ?`).get(this.region, canonical.tenantId) as { configuration_version: number } | undefined;
        return { saved: false as const, currentVersion: row?.configuration_version ?? null };
      }
      this.syncCalledNumbers(canonical);
      return { saved: true as const, version: expectedVersion + 1 };
    });
  }

  private syncCalledNumbers(profile: VersionedBusinessProfile): void {
    this.database.prepare("DELETE FROM called_numbers WHERE region_id = ? AND tenant_id = ?")
      .run(this.region, profile.tenantId);
    const insert = this.database.prepare(
      "INSERT INTO called_numbers(region_id, tenant_id, location_id, phone) VALUES (?, ?, ?, ?)",
    );
    for (const assignment of calledNumberAssignments(profile)) {
      insert.run(this.region, profile.tenantId, assignment.locationId, assignment.phone);
    }
  }

  private inTransaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* Transaction may already be closed. */ }
      throw error;
    }
  }
}

const calledNumberAssignments = (profile: VersionedBusinessProfile): Array<{ locationId: string; phone: string }> =>
  profile.schemaVersion === 2
    ? profile.locations.filter(({ active }) => active)
      .flatMap((location) => location.calledNumbers.map((phone) => ({ locationId: location.id, phone })))
    : profile.calledNumbers.map((phone) => ({ locationId: "default", phone }));
