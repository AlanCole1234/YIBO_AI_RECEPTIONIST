import { createLocalApplication, localAccessContext } from "./app/local-composition-root.js";
import { createApiServer } from "./api/index.js";

const port = Number(process.env.PORT ?? 3000);
const context = localAccessContext();
const server = await createApiServer(createLocalApplication(context));

await server.listen({ port, host: "127.0.0.1" });
console.log(`YIBO API listening on http://localhost:${port}`);
console.log(`Local data context: region=${context.region} tenant=${context.tenantId}`);
