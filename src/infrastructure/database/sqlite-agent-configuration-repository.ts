import type { DatabaseSync } from "node:sqlite";
import type {
  AgentConfiguration,
  AgentConfigurationRepository,
} from "../../modules/agents/index.js";
import type { RegionId, TenantId } from "../../shared/types/identifiers.js";

type ConfigurationRow = { configuration_json: string };

export class SqliteAgentConfigurationRepository implements AgentConfigurationRepository {
  constructor(private readonly database: DatabaseSync, private readonly region: RegionId) {}

  async getConfiguration(tenantId: TenantId): Promise<AgentConfiguration | null> {
    const row = this.database.prepare(`
      SELECT configuration_json FROM agent_configurations
      WHERE region_id = ? AND tenant_id = ?
    `).get(this.region, tenantId) as ConfigurationRow | undefined;
    return row ? JSON.parse(row.configuration_json) as AgentConfiguration : null;
  }

  async saveConfiguration(tenantId: TenantId, configuration: AgentConfiguration): Promise<void> {
    this.database.prepare(`
      INSERT INTO agent_configurations(region_id, tenant_id, configuration_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(region_id, tenant_id) DO UPDATE SET
        configuration_json = excluded.configuration_json,
        updated_at = excluded.updated_at
    `).run(this.region, tenantId, JSON.stringify(configuration), new Date().toISOString());
  }
}
