import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { attachHarness, type VoiceHarness } from "../../../apps/dev-voice/harness.js";
import type { YiboApplication } from "../../bootstrap/index.js";
import { hasAdminRole } from "../../modules/auth/index.js";
import { adminPrincipalFor, createAdminGuard, isAllowedLoginOrigin } from "../admin-guard.js";
import { adminSessionToken } from "../admin-session-cookie.js";

const PATH = "/api/voice-lab/stream";

export async function registerVoiceLabRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  const unavailable = (): string | undefined => {
    if (!app.config.hostedVoiceLabEnabled) return "Hosted Voice Lab has not been activated on this server.";
    if (!app.voiceLab || app.providerReadiness.telephony) return "Voice Lab requires a server with phone services disabled.";
    if (app.config.runtime !== "openai-realtime") return "OpenAI voice has not been activated on this server.";
    return undefined;
  };
  server.get("/api/voice-lab/status", { preHandler: createAdminGuard(app, "tenant_admin") }, async (request, reply) => {
    if (adminPrincipalFor(request).roles.includes("read_only")) return reply.code(403).send({ error: { code: "READ_ONLY_ROLE" } });
    reply.header("cache-control", "no-store");
    const reason = unavailable();
    return { enabled: !reason, ...(reason ? { reason } : {}) };
  });

  // No second runtime, database owner, public port or bearer token in the URL.
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 2_097_152, perMessageDeflate: false });
  const harnesses = new Set<VoiceHarness>();
  let stopping = false;
  let occupied = false;
  const authorize = async (request: IncomingMessage): Promise<boolean> => {
    try {
      if (!isAllowedLoginOrigin(request, app)) return false;
      const token = adminSessionToken(request);
      if (!token) return false;
      const verified = await app.adminAuth.sessions.verify(token, new Date());
      return verified.ok && verified.principal.tenantId === app.tenantId
        && hasAdminRole(verified.principal, "tenant_admin") && !verified.principal.roles.includes("read_only");
    } catch { return false; }
  };
  const reject = (socket: Duplex, code: number) => {
    if (!socket.destroyed) socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    // This API currently has no other upgrade routes. Reject query credentials,
    // tenant/location selectors and protocols rather than trusting browser input.
    if (request.url !== PATH || request.headers["sec-websocket-protocol"]) { reject(socket, 404); return; }
    if (stopping || unavailable()) { reject(socket, 503); return; }
    if (!isAllowedLoginOrigin(request, app)) { reject(socket, 403); return; }
    if (occupied) { reject(socket, 429); return; }
    occupied = true; // Reserve before asynchronous checks, including configuration reads.
    socket.on("error", () => {});
    const timeout = setTimeout(() => socket.destroy(), 5_000);
    void (async () => {
      let accepted = false;
      try {
        if (!await authorize(request)) { reject(socket, 401); return; }
        const profile = await app.business.getBusinessProfile(app.tenantId);
        const location = profile.ok ? profile.value.locations.find(item => item.active && item.calledNumbers.length > 0) : undefined;
        const number = location?.calledNumbers[0];
        if (!number) { reject(socket, 503); return; }
        const resolved = await app.business.resolveLocationByCalledNumber(number);
        if (!resolved.ok || resolved.value.tenantId !== app.tenantId || resolved.value.locationId !== location?.id) {
          reject(socket, 503); return;
        }
        if (stopping || socket.destroyed || !await authorize(request)) { reject(socket, 401); return; }
        sockets.handleUpgrade(request, socket, head, webSocket => {
          accepted = true;
          const harness = attachHarness(webSocket, { app, callRepository: app.voiceLab!.callReader,
            calledNumber: number, transcriptEnabled: false, audioDebug: false,
            hosted: { authorize: () => authorize(request) } });
          harnesses.add(harness);
          let checking = false;
          let alive = true;
          webSocket.on("pong", () => { alive = true; });
          // Revoke idle/paused sessions too; each incoming message also rechecks access.
          const accessTimer = setInterval(() => {
            if (checking) return;
            checking = true;
            void authorize(request).then(valid => {
              if (!valid) void harness.close("authorization_failed");
            }).finally(() => { checking = false; });
          }, 5_000);
          const heartbeat = setInterval(() => {
            if (!alive) { webSocket.terminate(); return; }
            alive = false;
            webSocket.ping();
          }, 30_000);
          const idle = setTimeout(() => { if (!harness.started) void harness.close("preview_idle"); }, 120_000);
          void harness.completed.then(() => {
            clearInterval(accessTimer); clearInterval(heartbeat); clearTimeout(idle);
            harnesses.delete(harness);
            occupied = false;
          });
        });
      } catch { reject(socket, 503); }
      finally { clearTimeout(timeout); if (!accepted) occupied = false; }
    })();
  };
  server.server.on("upgrade", upgrade);
  server.addHook("preClose", async () => {
    stopping = true;
    server.server.off("upgrade", upgrade);
    await Promise.all([...harnesses].map(harness => harness.close()));
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>(resolve => sockets.close(() => resolve()));
  });
}
