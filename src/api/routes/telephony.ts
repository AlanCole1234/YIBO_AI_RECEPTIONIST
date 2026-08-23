import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../app/index.js";
import { toHttpError } from "../http-errors.js";

interface TelephonyHeaders { "x-yibo-telephony-key"?: string }

export async function registerTelephonyRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.get("/api/integrations/telephony/status", async () => ({
    configured: app.telephony.configured,
    provider: "not-connected",
  }));

  server.post<{ Body: unknown; Headers: TelephonyHeaders }>("/api/integrations/telephony/events", async (request, reply) => {
    const result = await app.telephony.receive(request.body, request.headers["x-yibo-telephony-key"]);
    if (!result.ok) {
      const mapped = toHttpError(result.error);
      const statusCode = result.error.code === "NOT_CONFIGURED"
        ? 503
        : result.error.code === "UNAUTHORIZED"
          ? 401
          : result.error.code === "INVALID_EVENT"
            ? 400
            : mapped.statusCode;
      return reply.code(statusCode).send(mapped.payload);
    }
    return reply.code(202).send({ accepted: true });
  });
}
