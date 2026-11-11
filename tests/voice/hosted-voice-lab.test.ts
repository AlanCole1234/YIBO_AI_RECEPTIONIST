import { once } from "node:events";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiServer } from "../../src/api/server.js";
import { buildApplication, type BuildApplicationOptions } from "../../src/bootstrap/build-application.js";
import { InMemoryCallTelephonyGateway } from "../../src/bootstrap/in-memory-telephony.js";
import { ScriptedConversationRuntime } from "../../src/modules/conversation/index.js";
import type { AdminRole } from "../../src/modules/auth/index.js";

const servers: FastifyInstance[] = [];
const clients: WebSocket[] = [];
const waitFor = (assertion: () => unknown) => vi.waitFor(assertion, { timeout: 2_000, interval: 5 });
beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(async () => {
  for (const socket of clients.splice(0)) socket.terminate();
  for (const server of servers.splice(0)) await server.close();
  vi.restoreAllMocks();
});

async function fixture(options: BuildApplicationOptions = {}) {
  const runtime = new ScriptedConversationRuntime();
  const app = buildApplication({ runtime, environment: {
    YIBO_HOSTED_VOICE_LAB: "1", YIBO_RUNTIME: "openai-realtime", OPENAI_API_KEY: "synthetic-not-a-provider-key",
    YIBO_DASHBOARD_ORIGIN: "https://voice.example.test",
  }, ...options });
  const server = await createApiServer(app); servers.push(server);
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  const url = `ws://127.0.0.1:${address.port}/api/voice-lab/stream`;
  async function cookie(roles: AdminRole[] = ["owner"], tenantId = app.tenantId, expiresAt = new Date(Date.now() + 60_000)) {
    const token = await app.adminAuth.sessions.issue({ subject: "synthetic-owner", tenantId, roles, now: new Date(), expiresAt });
    return `yibo_admin_session=${encodeURIComponent(token)}`;
  }
  const session = await cookie();
  const headers = { origin: app.config.dashboardOrigin, cookie: session };
  async function reject(changes: Record<string, string | undefined> = {}, suffix = "") {
    return new Promise<number>((resolve, reject) => {
      const requestHeaders = Object.fromEntries(Object.entries({ ...headers, ...changes }).filter(([, value]) => value !== undefined));
      const socket = new WebSocket(url + suffix, { headers: requestHeaders }); clients.push(socket);
      socket.on("error", () => {});
      socket.on("unexpected-response", (_request, response) => { response.resume(); socket.terminate(); resolve(response.statusCode!); });
      socket.on("open", () => { socket.terminate(); reject(new Error("Unexpected authorized connection")); });
    });
  }
  async function connect() {
    const socket = new WebSocket(url, { headers }); clients.push(socket);
    const messages: Record<string, unknown>[] = [], audio: Buffer[] = [];
    socket.on("error", () => {});
    socket.on("message", (raw, binary) => { if (binary) audio.push(raw as Buffer); else messages.push(JSON.parse(raw.toString())); });
    await once(socket, "open");
    const events = (name: string) => messages.filter(message => message.event === name || message.type === name);
    await waitFor(() => expect(events("voice.lab.ready")).toHaveLength(1));
    const send = (message: Record<string, unknown>) => socket.send(JSON.stringify(message));
    const start = async () => { send({ type: "mic.start", sampleRate: 48_000, channels: 1 });
      await waitFor(() => expect(events("conversation.opened")).toHaveLength(1)); };
    return { socket, messages, audio, events, send, start, callId: String(events("voice.lab.ready")[0]!.callId) };
  }
  return { app, server, runtime, headers, cookie, reject, connect };
}

describe("authenticated hosted Voice Lab", () => {
  it("stays disabled by default and reports safe setup guidance", async () => {
    const f = await fixture({ environment: {} });
    const status = await f.server.inject({ url: "/api/voice-lab/status", headers: f.headers });
    expect(status.json()).toMatchObject({ enabled: false, reason: expect.stringContaining("not been activated") });
    expect(status.headers["cache-control"]).toBe("no-store");
    expect(await f.reject()).toBe(503);
    expect(f.runtime.sessions).toHaveLength(0);
  });
  it("does not advertise a synthetic runtime as real voice", async () => {
    const f = await fixture({ environment: { YIBO_HOSTED_VOICE_LAB: "1" } });
    expect((await f.server.inject({ url: "/api/voice-lab/status", headers: f.headers })).json()).toMatchObject({ enabled: false });
    expect(await f.reject()).toBe(503);
  });
  it("cannot attach browser calls to an installed phone gateway even with the switch enabled", async () => {
    const telephonyGateway = new InMemoryCallTelephonyGateway();
    const answer = vi.spyOn(telephonyGateway, "answer");
    const f = await fixture({ telephonyGateway });
    expect(f.app.voiceLab).toBeUndefined();
    expect(await f.reject()).toBe(503);
    expect(answer).not.toHaveBeenCalled();
  });
  it.each(["missing", "malformed", "foreign", "expired", "revoked", "secretary", "readonly-owner"])("rejects %s authorization before opening a provider session", async kind => {
    const f = await fixture();
    let cookie: string | undefined;
    if (kind === "malformed") cookie = "yibo_admin_session=%zz";
    if (kind === "foreign") cookie = await f.cookie(["owner"], "another-tenant");
    if (kind === "expired") cookie = await f.cookie(["owner"], f.app.tenantId, new Date(Date.now() - 1000));
    if (kind === "secretary") cookie = await f.cookie(["secretary"]);
    if (kind === "readonly-owner") cookie = await f.cookie(["owner", "read_only"]);
    if (kind === "revoked") {
      cookie = f.headers.cookie;
      await f.app.adminAuth.sessions.revoke(decodeURIComponent(cookie.split("=")[1]!));
    }
    expect(await f.reject({ cookie })).toBe(401);
    expect(f.runtime.sessions).toHaveLength(0);
  });
  it.each([undefined, "https://attacker.test", "http://voice.example.test"])("rejects cross-site/missing origin %s", async origin => {
    const f = await fixture(); expect(await f.reject({ origin })).toBe(403);
    expect(f.runtime.sessions).toHaveLength(0);
  });
  it.each(["?tenantId=another-tenant", "?token=synthetic", "?locationId=other"])("rejects browser selectors and query credentials: %s", async suffix => {
    const f = await fixture(); expect(await f.reject({}, suffix)).toBe(404);
  });
  it("protects status with the same admin role, including mixed read-only roles", async () => {
    const f = await fixture();
    expect((await f.server.inject({ url: "/api/voice-lab/status" })).statusCode).toBe(401);
    for (const roles of [["secretary"], ["owner", "read_only"]] as AdminRole[][]) {
      expect((await f.server.inject({ url: "/api/voice-lab/status", headers: { cookie: await f.cookie(roles) } })).statusCode).toBe(403);
    }
  });
  it("uses saved Voice Lab policy, forwards audio and usage, closes once, and supports a fresh saved configuration", async () => {
    const f = await fixture();
    const configuration = (await f.app.agentConfiguration.get(f.app.tenantId))!;
    configuration.toolPolicies.channels.voice_lab.enabledTools = ["get_service_information"];
    configuration.toolPolicies.channels.phone.enabledTools = [];
    await f.app.agentConfiguration.update(f.app.tenantId, configuration);
    const first = await f.connect();
    expect(f.runtime.sessions).toHaveLength(0); // Merely opening the page is free.
    await first.start();
    expect(f.runtime.openedInputs[0]!.agent.channel).toBe("voice_lab");
    expect(f.runtime.openedInputs[0]!.agent.tools.map(tool => tool.name)).toEqual(["get_service_information", "end_call"]);
    first.socket.send(Buffer.from(new Float32Array([0.1, 0.2, 0.3, 0.4]).buffer));
    await waitFor(() => expect(f.runtime.latestSession.receivedAudio).toHaveLength(1));
    f.runtime.latestSession.emit({ type: "audio.delta", assistantTurnId: "reply", frame: {
      data: new Uint8Array([1, 2, 3, 4]), codec: "pcm16", sampleRate: 24_000, channels: 1 } });
    await waitFor(() => expect(first.audio).toHaveLength(1));
    f.runtime.latestSession.emit({ type: "usage", inputAudioTokens: 20, outputAudioTokens: 10, totalTokens: 30 });
    f.runtime.latestSession.emit({ type: "assistant.transcript", text: "synthetic-private-transcript-marker", final: true });
    await waitFor(() => expect(first.events("usage")[0]).toMatchObject({ totalTokens: 30 }));
    expect(JSON.stringify(first.messages)).not.toContain("synthetic-private-transcript-marker");
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("synthetic-private-transcript-marker");
    first.send({ type: "close" }); first.send({ type: "close" });
    await waitFor(() => expect(f.runtime.latestSession.closeCount).toBe(1));
    await waitFor(() => expect(first.events("conversation.closed")).toHaveLength(1));
    await expect(f.app.voiceLab!.callReader.findByCallId(first.callId)).resolves.toMatchObject({ state: "COMPLETED" });
    await expect(f.app.voice.open(first.callId)).resolves.toMatchObject({ ok: false });
    configuration.audio.voice = "cedar";
    await f.app.agentConfiguration.update(f.app.tenantId, configuration);
    const next = await f.connect(); await next.start();
    expect(next.events("voice.lab.ready")[0]!.voice).toBe("cedar");
    expect(f.runtime.openedInputs[1]!.agent.voice).toBe("cedar");
    expect(next.callId).not.toBe(first.callId);
  });
  it("rejects simultaneous previews without starting a second runtime", async () => {
    const f = await fixture(); const first = await f.connect(); await first.start();
    expect(await f.reject()).toBe(429);
    expect(f.runtime.sessions).toHaveLength(1);
  });
  it("reserves admission while configuration is still loading", async () => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = f.app.business.getBusinessProfile.bind(f.app.business);
    const read = vi.spyOn(f.app.business, "getBusinessProfile").mockImplementationOnce(async tenant => {
      await gate; return original(tenant);
    });
    const opening = f.connect();
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(await f.reject()).toBe(429);
    release(); await opening;
    expect(f.runtime.sessions).toHaveLength(0);
  });
  it("closes an input flood instead of growing an unbounded audio queue", async () => {
    const f = await fixture(), connection = await f.connect(); await connection.start();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(f.runtime.latestSession, "sendAudio").mockImplementationOnce(async () => { await gate; });
    const frame = Buffer.from(new Float32Array(4096).buffer);
    for (let index = 0; index < 90; index++) connection.socket.send(frame);
    try {
      await waitFor(() => expect(connection.events("conversation.closed")).toHaveLength(1));
    } finally { release(); }
    await waitFor(() => expect(f.runtime.latestSession.closeCount).toBe(1));
  });
  it("cannot cross tenant boundaries if routing changes after the socket connects", async () => {
    const f = await fixture(), connection = await f.connect();
    const resolve = f.app.business.resolveLocationByCalledNumber.bind(f.app.business);
    vi.spyOn(f.app.business, "resolveLocationByCalledNumber").mockImplementation(async number => {
      const result = await resolve(number);
      return result.ok ? { ...result, value: { ...result.value, tenantId: "another-tenant" } } : result;
    });
    connection.send({ type: "mic.start", sampleRate: 48_000, channels: 1 });
    await waitFor(() => expect(connection.events("conversation.closed")).toHaveLength(1));
    expect(f.runtime.sessions).toHaveLength(0);
    await expect(f.app.voiceLab!.callReader.findByCallId(connection.callId)).resolves.toBeNull();
  });
  it("waits for browser playback drain before natural goodbye and does not generate a second response", async () => {
    const f = await fixture(), connection = await f.connect(); await connection.start();
    const session = f.runtime.latestSession;
    const sendToolResult = vi.spyOn(session, "sendToolResult");
    session.emit({ type: "assistant.response_created", responseId: "goodbye" });
    session.emit({ type: "audio.delta", assistantTurnId: "goodbye", frame: {
      data: new Uint8Array([1, 2, 3, 4]), codec: "pcm16", sampleRate: 24_000, channels: 1 } });
    session.emit({ type: "tool.call", toolCallId: "end", name: "end_call", arguments: {} });
    session.emit({ type: "assistant.audio_completed", assistantTurnId: "goodbye" });
    session.emit({ type: "assistant.response_done", status: "completed" });
    await waitFor(() => expect(connection.events("playback.finish")).toHaveLength(1));
    const finish = connection.events("playback.finish")[0]!;
    expect(session.closeCount).toBe(0);
    connection.send({ type: "playback.idle", requestId: finish.requestId, assistantTurnId: "goodbye" });
    await waitFor(() => expect(connection.events("conversation.closed")).toHaveLength(1));
    expect(sendToolResult).toHaveBeenCalledOnce();
    expect(sendToolResult).toHaveBeenCalledWith({ toolCallId: "end", ok: true, data: { ending: true } }, { requestResponse: false });
    expect(session.closeCount).toBe(1);
  });
  it("closes an idle revoked connection without needing any further browser audio", async () => {
    const f = await fixture(), connection = await f.connect();
    await f.server.inject({ method: "POST", url: "/api/auth/logout", headers: f.headers });
    await vi.waitFor(() => expect(connection.events("conversation.closed")).toHaveLength(1), { timeout: 6_000, interval: 25 });
    expect(f.runtime.sessions).toHaveLength(0);
  }, 8_000);
  it.each([false, true])("honors logout before the next microphone frame (started=%s)", async started => {
    const f = await fixture(), connection = await f.connect();
    if (started) await connection.start();
    await f.server.inject({ method: "POST", url: "/api/auth/logout", headers: f.headers });
    connection.send({ type: "mic.start", sampleRate: 48_000, channels: 1 });
    await waitFor(() => expect(connection.events("conversation.closed")).toHaveLength(1));
    expect(f.runtime.sessions).toHaveLength(started ? 1 : 0);
    if (started) expect(f.runtime.latestSession.closeCount).toBe(1);
  });
  it("cleans up a disconnect during asynchronous provider startup", async () => {
    const f = await fixture(), connection = await f.connect();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = f.runtime.openSession.bind(f.runtime);
    const open = vi.spyOn(f.runtime, "openSession").mockImplementation(async input => { await gate; return original(input); });
    connection.send({ type: "mic.start", sampleRate: 48_000, channels: 1 });
    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    connection.socket.terminate(); release();
    await waitFor(() => expect(f.runtime.latestSession.closeCount).toBe(1));
    await expect(f.app.voiceLab!.callReader.findByCallId(connection.callId)).resolves.toMatchObject({ state: "COMPLETED" });
  });
  it("server shutdown closes the existing runtime and releases media", async () => {
    const f = await fixture(), connection = await f.connect(); await connection.start();
    await f.server.close();
    expect(f.runtime.latestSession.closeCount).toBe(1);
    await expect(f.app.voice.open(connection.callId)).resolves.toMatchObject({ ok: false });
  });
  it("rejects malformed input before provider startup without leaking raw error text", async () => {
    const f = await fixture(), connection = await f.connect();
    connection.send({ type: "mic.start", sampleRate: 1, channels: 10000 });
    await waitFor(() => expect(connection.events("conversation.closed")).toHaveLength(1));
    expect(f.runtime.sessions).toHaveLength(0);
    expect(connection.events("error")[0]!.error).toBe("Voice test failed. Please end the test and try again.");
  });
  it("caps WebSocket payload size and cleans up the active test", async () => {
    const f = await fixture(), connection = await f.connect(); await connection.start();
    connection.socket.send(Buffer.alloc(2_097_153));
    await waitFor(() => expect(f.runtime.latestSession.closeCount).toBe(1));
    await expect(f.app.voice.open(connection.callId)).resolves.toMatchObject({ ok: false });
  });
});
