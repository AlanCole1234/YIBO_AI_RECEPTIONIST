import { createDevelopmentApplication } from "./app/index.js";
import { createApiServer } from "./api/index.js";

const port = Number(process.env.PORT ?? 3000);
const server = await createApiServer(createDevelopmentApplication());

await server.listen({ port, host: "127.0.0.1" });
console.log(`YIBO API listening on http://localhost:${port}`);
