import type { TenantId } from "../../../shared/types/identifiers.js";
import type {
  AgentConfiguration,
  AgentConfigurationRepository,
  VersionedAgentConfiguration,
} from "../ports/agent-dependencies.js";
import { upgradeAgentConfiguration } from "../application/upgrade-agent-configuration.js";

export class InMemoryAgentConfigurationSource implements AgentConfigurationRepository {
  private readonly configurations = new Map<TenantId, AgentConfiguration>();

  constructor(entries: Array<{ tenantId: TenantId; configuration: VersionedAgentConfiguration }>) {
    for (const entry of entries) this.configurations.set(entry.tenantId, upgradeAgentConfiguration(entry.configuration));
  }

  async getConfiguration(tenantId: TenantId): Promise<AgentConfiguration | null> {
    const value = this.configurations.get(tenantId);
    return value ? structuredClone(value) : null;
  }

  async compareAndSaveConfiguration(tenantId: TenantId, configuration: AgentConfiguration, expected: AgentConfiguration | null): Promise<boolean> {
    if (JSON.stringify(this.configurations.get(tenantId) ?? null) !== JSON.stringify(expected)) return false;
    this.configurations.set(tenantId, structuredClone(configuration));
    return true;
  }

  async saveConfiguration(tenantId: TenantId, configuration: AgentConfiguration): Promise<void> {
    this.configurations.set(tenantId, structuredClone(configuration));
  }
}
