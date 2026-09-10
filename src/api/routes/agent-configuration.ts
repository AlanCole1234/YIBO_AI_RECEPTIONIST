import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";
import {
  AGENT_CONFIGURATION_DEFAULTS_VERSION,
  AGENT_TOOL_DEFINITIONS,
  type AgentToolName,
} from "../../modules/agents/index.js";
import { adminPrincipalFor, createAdminGuard } from "../admin-guard.js";
import { toHttpError } from "../http-errors.js";

export async function registerAgentConfigurationRoutes(
  server: FastifyInstance,
  app: YiboApplication,
): Promise<void> {
  server.get("/api/configuration", { preHandler: createAdminGuard(app, "tenant_admin") }, async (_request, reply) => {
    const business = await app.business.getBusinessProfile(app.tenantId);
    if (!business.ok) {
      const mapped = toHttpError(business.error);
      return reply.code(mapped.statusCode).send(mapped.payload);
    }

    return {
      current: await app.agentConfiguration.get(app.tenantId),
      recommended: app.agentConfiguration.recommended(
        business.value.locale,
        business.value.name,
        app.config.openAiRealtimeModel,
      ),
      availableTools: AGENT_TOOL_DEFINITIONS.filter(({ name }) => !isDeveloperTestTool(name)).map(({ name, description, presentation }) => ({
        name,
        description,
        ...presentation,
      })),
      secrets: { apiKeyConfigured: Boolean(app.config.openAiApiKey) },
    };
  });

  server.put("/api/configuration", { preHandler: createAdminGuard(app, "tenant_admin") }, async (request, reply) => {
    const before = await app.agentConfiguration.get(app.tenantId);
    let configuration;
    try {
      configuration = await app.agentConfiguration.update(app.tenantId, request.body as never);
    } catch (error) {
      return reply.code(400).send({
        error: {
          code: "INVALID_AGENT_CONFIGURATION",
          message: error instanceof Error ? error.message : "Invalid agent configuration",
        },
      });
    }
    await app.adminAudit.recordMutation({
      principal: adminPrincipalFor(request),
      entityType: "agent_configuration",
      entityId: app.tenantId,
      action: before ? "update" : "create",
      entityVersion: AGENT_CONFIGURATION_DEFAULTS_VERSION,
      before,
      after: configuration,
    });
    return { configuration, appliesTo: "next-conversation" as const };
  });
}

const isDeveloperTestTool = (name: AgentToolName): boolean =>
  name === "enable_developer_test_mode" || name === "delete_test_appointments";
