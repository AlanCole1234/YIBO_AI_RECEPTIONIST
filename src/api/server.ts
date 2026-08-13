import Fastify, { type FastifyInstance } from "fastify";
import type { YiboApplication } from "../app/index.js";
import { registerAppointmentRoutes } from "./routes/appointments.js";
import { registerAvailabilityRoutes } from "./routes/availability.js";
import { registerBusinessRoutes } from "./routes/business.js";
import { registerCustomerRoutes } from "./routes/customers.js";
import { registerHealthRoutes } from "./routes/health.js";

export async function createApiServer(app: YiboApplication): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  await registerHealthRoutes(server);
  await registerBusinessRoutes(server, app);
  await registerCustomerRoutes(server, app);
  await registerAvailabilityRoutes(server, app);
  await registerAppointmentRoutes(server, app);
  return server;
}
