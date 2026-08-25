import type { TenantId } from "../../../shared/types/identifiers.js";
import type {
  AgentConfiguration,
  AgentConfigurationRepository,
} from "../ports/agent-dependencies.js";

export class InMemoryAgentConfigurationSource implements AgentConfigurationRepository {
  private readonly configurations = new Map<TenantId, AgentConfiguration>();

  constructor(entries: Array<{ tenantId: TenantId; configuration: AgentConfiguration }>) {
    for (const entry of entries) this.configurations.set(entry.tenantId, structuredClone(entry.configuration));
  }

  async getConfiguration(tenantId: TenantId): Promise<AgentConfiguration | null> {
    const value = this.configurations.get(tenantId);
    return value ? structuredClone(value) : null;
  }

  async saveConfiguration(tenantId: TenantId, configuration: AgentConfiguration): Promise<void> {
    this.configurations.set(tenantId, structuredClone(configuration));
  }
}
