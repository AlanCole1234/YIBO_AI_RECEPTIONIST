import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_BEHAVIOR } from "../../src/modules/agents/index.js";

const sockets = vi.hoisted(() => ({ instances: [] as any[] }));
vi.mock("openai/realtime/ws", () => ({
  OpenAIRealtimeWS: class extends EventEmitter {
    socket = new EventEmitter();
    send = vi.fn();
    close = vi.fn();
    constructor(readonly options: unknown) {
      super();
      sockets.instances.push(this);
    }
  },
}));
import { OpenAIRealtimeAdapter } from "../../src/modules/conversation/index.js";

function start() {
  const adapter = new OpenAIRealtimeAdapter({ apiKey: "test-key", mode: "text", logger: { error: vi.fn() } });
  return adapter.openSession({ conversationId: "startup-test", agent: {
    instructions: "Help the caller.", locale: "en-US", tools: [], toolChoice: "auto", parallelToolCalls: false,
    conversation: { model: "gpt-realtime-2.1", maxOutputTokens: 512, reasoningEffort: "minimal",
      tracing: "disabled", truncation: { mode: "auto" } },
    audio: { voice: "marin", noiseReduction: "near_field", turnDetection: { type: "manual" } },
    behavior: structuredClone(DEFAULT_AGENT_BEHAVIOR),
  } });
}

beforeEach(() => { sockets.instances.length = 0; });

describe("Realtime SDK startup boundary", () => {
  it("registers an SDK error listener immediately and bounds the WebSocket handshake", async () => {
    const opening = start();
    const sdk = sockets.instances[0];
    expect(sdk.listenerCount("error")).toBe(1);
    expect(sdk.options).toMatchObject({ options: { handshakeTimeout: 10_000 } });
    const failure = new Error("Handshake timed out");
    sdk.emit("error", failure);
    sdk.socket.emit("error", failure);
    await expect(opening).rejects.toThrow("Handshake timed out");
    expect(sdk.socket.listenerCount("open")).toBe(0);
    expect(sdk.socket.listenerCount("close")).toBe(0);
  });

  it("rejects close before open rather than leaving call startup unresolved", async () => {
    const opening = start();
    sockets.instances[0].socket.emit("close", 1006, Buffer.alloc(0));
    await expect(opening).rejects.toThrow("closed before opening");
  });

  it("opens normally and forwards a provider error once despite both SDK event channels", async () => {
    const opening = start();
    const sdk = sockets.instances[0];
    sdk.socket.emit("open");
    const session = await opening;
    const error = { code: "invalid_request", message: "Invalid configuration" };
    sdk.emit("event", { type: "error", error });
    sdk.emit("error", { error, message: error.message });
    await session.close();
    const events = [];
    for await (const event of session.events()) events.push(event);
    expect(events.filter((event) => event.type === "error")).toHaveLength(1);
    expect(sdk.close).toHaveBeenCalledOnce();
  });
});
