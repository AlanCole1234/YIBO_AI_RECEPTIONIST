import { DatabaseSync } from "node:sqlite";
import { DEVELOPMENT_BUSINESS } from "../../src/app/index.js";
import { AgentConfigurationService } from "../../src/modules/agents/index.js";
import { SqliteAgentConfigurationRepository } from "../../src/infrastructure/database/sqlite-agent-configuration-repository.js";
import { SqliteConversationUsageRepository } from "../../src/infrastructure/database/sqlite-conversation-usage-repository.js";
import { SqliteCallRepository } from "../../src/infrastructure/database/sqlite-call-repository.js";
import { migrateDatabase, seedBusiness } from "../../src/infrastructure/database/regional-database.js";

const database = new DatabaseSync(":memory:");
try {
  migrateDatabase(database);
  seedBusiness(database, DEVELOPMENT_BUSINESS);
  const configurations = new SqliteAgentConfigurationRepository(database, "MX");
  const service = new AgentConfigurationService(configurations);
  const recommended = service.recommended("es-MX", DEVELOPMENT_BUSINESS.name, "gpt-realtime-2.1");
  const turn = recommended.audio.turnDetection;
  const legacyConfiguration = {
    instructions: recommended.identity.instructions,
    locale: recommended.identity.locale,
    voice: recommended.audio.voice,
    enabledTools: recommended.enabledTools,
    conversation: {
      model: recommended.conversation.model,
      maxOutputTokens: recommended.conversation.maxOutputTokens,
      reasoningEffort: recommended.conversation.reasoningEffort,
      turnDetection: turn.type === "server_vad" ? {
        ...(turn.threshold === undefined ? {} : { threshold: turn.threshold }),
        ...(turn.prefixPaddingMs === undefined ? {} : { prefixPaddingMs: turn.prefixPaddingMs }),
        ...(turn.silenceDurationMs === undefined ? {} : { silenceDurationMs: turn.silenceDurationMs }),
      } : {},
    },
  };
  database.prepare(`INSERT INTO agent_configurations(region_id, tenant_id, configuration_json, updated_at)
    VALUES (?, ?, ?, ?)`).run(
      "MX", DEVELOPMENT_BUSINESS.tenantId, JSON.stringify(legacyConfiguration), new Date().toISOString(),
    );
  const configuration = await service.get(DEVELOPMENT_BUSINESS.tenantId);
  const persisted = JSON.parse((database.prepare(`SELECT configuration_json FROM agent_configurations
    WHERE region_id = ? AND tenant_id = ?`).get("MX", DEVELOPMENT_BUSINESS.tenantId) as { configuration_json: string }).configuration_json) as { schemaVersion?: number };
  const changed = structuredClone(configuration!); changed.identity.instructions += " Updated.";
  const cas = await Promise.all([
    configurations.compareAndSaveConfiguration(DEVELOPMENT_BUSINESS.tenantId, changed, configuration),
    configurations.compareAndSaveConfiguration(DEVELOPMENT_BUSINESS.tenantId, recommended, configuration),
  ]);
  const otherBusiness = structuredClone(DEVELOPMENT_BUSINESS);
  otherBusiness.tenantId = "new-tenant"; otherBusiness.businessId = "new-business";
  for (const location of otherBusiness.locations) location.calledNumbers = [];
  seedBusiness(database, otherBusiness);
  const inserted = await configurations.compareAndSaveConfiguration("new-tenant", recommended, null);
  const duplicate = await configurations.compareAndSaveConfiguration("new-tenant", changed, null);
  const isolated = await configurations.getConfiguration("new-tenant");
  const usage = new SqliteConversationUsageRepository(database, "MX");
  const calls = new SqliteCallRepository(database, "MX");
  await calls.create({
    tenantId: DEVELOPMENT_BUSINESS.tenantId, locationId: "default", callId: "call-1", from: "+529990000001",
    to: DEVELOPMENT_BUSINESS.locations[0]!.calledNumbers[0]!, state: "RINGING",
    createdAt: "2026-08-25T10:00:00.000Z", updatedAt: "2026-08-25T10:00:00.000Z",
  });
  await calls.updateState("call-1", "COMPLETED", "2026-08-25T10:03:00.000Z");
  await usage.record({
    tenantId: DEVELOPMENT_BUSINESS.tenantId, callId: "call-1", occurredAt: new Date().toISOString(),
    inputTokens: 100, outputTokens: 25, inputAudioMs: 12_000, outputAudioMs: 4_000, toolCalls: 2,
  });
  console.log(JSON.stringify({
    cas, inserted, duplicate, isolated: isolated?.identity.instructions === recommended.identity.instructions,
    configuration,
    persistedSchemaVersion: persisted.schemaVersion,
    usage: await usage.summarize(DEVELOPMENT_BUSINESS.tenantId),
    calls: await calls.listByTenant(DEVELOPMENT_BUSINESS.tenantId, 25),
  }));
} finally {
  database.close();
}
