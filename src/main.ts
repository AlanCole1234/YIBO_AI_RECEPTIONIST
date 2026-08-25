import "dotenv/config";
import { buildConfiguredApplication } from "./bootstrap/build-configured-application.js";
import { createApiServer } from "./api/index.js";

const port = Number(process.env.PORT ?? 3000);
const application = buildConfiguredApplication({
  environment: process.env,
  ...(process.env.YIBO_TENANT_ID?.trim() ? { tenantId: process.env.YIBO_TENANT_ID.trim() } : {}),
});
const server = await createApiServer(application);

await server.listen({ port, host: "127.0.0.1" });
console.log(`YIBO API listening on http://localhost:${port}`);
console.log(`Local tenant: ${application.tenantId}`);
