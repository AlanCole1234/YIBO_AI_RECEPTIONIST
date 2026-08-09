import type { TenantId } from "../../../shared/types/identifiers.js";
import type {
  AgentConfiguration,
  AgentConfigurationProvider,
} from "../ports/agent-dependencies.js";

export class InMemoryAgentConfigurationProvider implements AgentConfigurationProvider {
  private readonly configurations = new Map<TenantId, AgentConfiguration>();

  constructor(entries: Array<{ tenantId: TenantId; configuration: AgentConfiguration }>) {
    for (const entry of entries) this.configurations.set(entry.tenantId, { ...entry.configuration });
  }

  async getConfiguration(tenantId: TenantId): Promise<AgentConfiguration | null> {
    const value = this.configurations.get(tenantId);
    return value ? { ...value } : null;
  }
}
