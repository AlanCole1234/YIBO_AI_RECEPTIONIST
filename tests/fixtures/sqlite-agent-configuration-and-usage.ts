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
  await service.update(DEVELOPMENT_BUSINESS.tenantId, recommended);
  const usage = new SqliteConversationUsageRepository(database, "MX");
  const calls = new SqliteCallRepository(database, "MX");
  await calls.create({
    tenantId: DEVELOPMENT_BUSINESS.tenantId, callId: "call-1", from: "+529990000001",
    to: DEVELOPMENT_BUSINESS.calledNumbers[0]!, state: "RINGING",
    createdAt: "2026-08-25T10:00:00.000Z", updatedAt: "2026-08-25T10:00:00.000Z",
  });
  await calls.updateState("call-1", "COMPLETED", "2026-08-25T10:03:00.000Z");
  await usage.record({
    tenantId: DEVELOPMENT_BUSINESS.tenantId, callId: "call-1", occurredAt: new Date().toISOString(),
    inputTokens: 100, outputTokens: 25, inputAudioMs: 12_000, outputAudioMs: 4_000, toolCalls: 2,
  });
  console.log(JSON.stringify({
    configuration: await service.get(DEVELOPMENT_BUSINESS.tenantId),
    usage: await usage.summarize(DEVELOPMENT_BUSINESS.tenantId),
    calls: await calls.listByTenant(DEVELOPMENT_BUSINESS.tenantId, 25),
  }));
} finally {
  database.close();
}
