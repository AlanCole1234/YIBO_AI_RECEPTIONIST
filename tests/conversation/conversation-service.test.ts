import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_BEHAVIOR, type AgentDefinition, type AgentToolResult, type ToolExecutor } from "../../src/modules/agents/index.js";
import {
  ConversationService,
  ScriptedConversationRuntime,
  type AudioFrame,
  type ConversationTransport,
} from "../../src/modules/conversation/index.js";

const trustedContext = {
  tenantId: "tenant-1",
  locationId: "default",
  callId: "call-1",
  customerId: "customer-1",
};

const audio = (value: number, codec = "test/linear"): AudioFrame => ({
  data: new Uint8Array([value]),
  codec,
  sampleRate: 24_000,
  channels: 1,
});

const stream = async function* (...frames: AudioFrame[]): AsyncGenerator<AudioFrame> {
  for (const frame of frames) yield frame;
};

function fixture(inboundAudio: AsyncIterable<AudioFrame> = stream()) {
  const runtime = new ScriptedConversationRuntime();
  const execute = vi.fn<ToolExecutor["execute"]>(async (_context, call) => ({
    toolCallId: call.toolCallId,
    ok: true as const,
    data: { slots: ["2026-08-26T15:00:00.000Z"] },
  }));
  const toolExecutor: ToolExecutor = { execute };
  const agent: AgentDefinition = {
    instructions: "Help the caller safely.",
    locale: "es-MX",
    voice: "neutral",
    conversation: {
      model: "gpt-realtime-2.1", maxOutputTokens: 512, reasoningEffort: "minimal",
      tracing: "disabled", truncation: { mode: "auto" },
    },
    audio: {
      voice: "neutral", noiseReduction: "near_field",
      turnDetection: { type: "server_vad", createResponse: true, interruptResponse: true },
    },
    behavior: structuredClone(DEFAULT_AGENT_BEHAVIOR),
    toolChoice: "auto",
    tools: [{
      name: "check_availability",
      description: "Find available appointment times",
      inputSchema: { type: "object" },
    }],
    toolExecutor,
    trustedContext,
  };
  const writtenAudio: AudioFrame[] = [];
  const closeTransport = vi.fn(async () => undefined);
  const interruptPlayback = vi.fn(async () => undefined as { assistantTurnId: string; audioEndMs: number } | undefined);
  const transport: ConversationTransport = {
    inboundAudio,
    outboundAudio: {
      write: async (frame) => { writtenAudio.push(frame); },
      interrupt: interruptPlayback,
    },
    close: closeTransport,
  };
  const service = new ConversationService({ runtime });

  return { agent, closeTransport, execute, interruptPlayback, runtime, service, transport, writtenAudio };
}

const start = (value: ReturnType<typeof fixture>) => value.service.start({
  conversationId: "conversation-1",
  agent: value.agent,
  transport: value.transport,
});

describe("ConversationService", () => {
  it("opens one runtime session and moves audio in both directions without assuming a codec", async () => {
    const inbound = [audio(1, "audio/custom-a"), audio(2, "audio/custom-b")];
    const value = fixture(stream(...inbound));
    const session = await start(value);

    expect(value.runtime.openedInputs).toEqual([{
      conversationId: "conversation-1",
      agent: {
        instructions: value.agent.instructions,
        locale: value.agent.locale,
        voice: value.agent.voice,
        conversation: value.agent.conversation,
        audio: value.agent.audio,
        behavior: value.agent.behavior,
        toolChoice: value.agent.toolChoice,
        tools: value.agent.tools,
      },
    }]);
    await eventually(() => expect(value.runtime.latestSession.receivedAudio).toEqual(inbound));

    const outbound = audio(3, "audio/custom-c");
    value.runtime.latestSession.emit({ type: "audio.delta", assistantTurnId: "assistant-1", frame: outbound });
    await eventually(() => expect(value.writtenAudio).toEqual([outbound]));

    value.runtime.latestSession.emit({ type: "closed", reason: "runtime-completed" });
    await expect(session.completed).resolves.toEqual({ status: "closed", reason: "runtime-completed" });
    await eventually(() => expect(value.closeTransport).toHaveBeenCalledTimes(1));
  });

  it("executes tool calls with trusted context and returns the correlated result", async () => {
    const value = fixture();
    const session = await start(value);

    value.runtime.latestSession.emit({
      type: "tool.call",
      toolCallId: "tool-42",
      name: "check_availability",
      arguments: { serviceId: "service-1" },
    });

    await eventually(() => expect(value.execute).toHaveBeenCalledWith(trustedContext, {
      toolCallId: "tool-42",
      name: "check_availability",
      arguments: { serviceId: "service-1" },
    }));
    await eventually(() => expect(value.runtime.latestSession.receivedToolResults).toEqual([{
      toolCallId: "tool-42",
      ok: true,
      data: { slots: ["2026-08-26T15:00:00.000Z"] },
    }]));

    await session.close();
  });

  it("reports a runtime error and closes all resources", async () => {
    const value = fixture();
    const session = await start(value);

    value.runtime.latestSession.emit({
      type: "error",
      code: "TEMPORARILY_UNAVAILABLE",
      message: "Conversation runtime is temporarily unavailable",
      retryable: true,
    });

    await expect(session.completed).resolves.toEqual({
      status: "failed",
      error: {
        code: "RUNTIME_ERROR",
        message: "Conversation runtime is temporarily unavailable",
        retryable: true,
      },
    });
    await eventually(() => expect(value.runtime.latestSession.closeCount).toBe(1));
    expect(value.closeTransport).toHaveBeenCalledTimes(1);
  });

  it("delegates interruption to the active runtime session", async () => {
    const value = fixture();
    const session = await start(value);

    await session.interrupt();

    expect(value.runtime.latestSession.interruptCount).toBe(1);
    await session.close();
  });

  it("stops local playback, interrupts the runtime, and drops stale audio on barge-in", async () => {
    const value = fixture();
    const session = await start(value);
    value.interruptPlayback.mockResolvedValue({ assistantTurnId: "assistant-1", audioEndMs: 420 });

    value.runtime.latestSession.emit({ type: "audio.delta", assistantTurnId: "assistant-1", frame: audio(1) });
    await eventually(() => expect(value.writtenAudio).toHaveLength(1));
    value.runtime.latestSession.emit({ type: "user.speech_started" });
    await eventually(() => expect(value.runtime.latestSession.interruptions).toEqual([{
      assistantTurnId: "assistant-1",
      audioEndMs: 420,
    }]));

    value.runtime.latestSession.emit({ type: "audio.delta", assistantTurnId: "assistant-1", frame: audio(2) });
    value.runtime.latestSession.emit({ type: "audio.delta", assistantTurnId: "assistant-2", frame: audio(3) });
    await eventually(() => expect(value.writtenAudio.map((frame) => frame.data[0])).toEqual([1, 3]));
    await session.close();
  });

  it("handles repeated interruptions and keeps forwarding the newest assistant turn", async () => {
    const value = fixture();
    const session = await start(value);
    value.interruptPlayback
      .mockResolvedValueOnce({ assistantTurnId: "assistant-1", audioEndMs: 220 })
      .mockResolvedValueOnce({ assistantTurnId: "assistant-2", audioEndMs: 140 });

    value.runtime.latestSession.emit({ type: "audio.delta", assistantTurnId: "assistant-1", frame: audio(1) });
    await eventually(() => expect(value.writtenAudio).toHaveLength(1));
    value.runtime.latestSession.emit({ type: "user.speech_started" });
    await eventually(() => expect(value.runtime.latestSession.interruptions).toEqual([{ assistantTurnId: "assistant-1", audioEndMs: 220 }]));

    value.runtime.latestSession.emit({ type: "audio.delta", assistantTurnId: "assistant-2", frame: audio(2) });
    await eventually(() => expect(value.writtenAudio.map((frame) => frame.data[0])).toEqual([1, 2]));
    value.runtime.latestSession.emit({ type: "user.speech_started" });
    await eventually(() => expect(value.runtime.latestSession.interruptions).toEqual([
      { assistantTurnId: "assistant-1", audioEndMs: 220 },
      { assistantTurnId: "assistant-2", audioEndMs: 140 },
    ]));

    value.runtime.latestSession.emit({ type: "audio.delta", assistantTurnId: "assistant-3", frame: audio(3) });
    await eventually(() => expect(value.writtenAudio.map((frame) => frame.data[0])).toEqual([1, 2, 3]));
    await session.close();
  });

  it("keeps receiving speech events while an interrupted calendar tool is still completing", async () => {
    const value = fixture();
    let resolveTool!: (result: AgentToolResult) => void;
    value.execute.mockImplementationOnce(() => new Promise<AgentToolResult>((resolve) => { resolveTool = resolve; }));
    const observed: string[] = [];
    const session = await value.service.start({
      conversationId: "conversation-1", agent: value.agent, transport: value.transport,
      observeEvent: (event) => observed.push(event.type),
    });

    value.runtime.latestSession.emit({ type: "tool.call", toolCallId: "calendar-1", name: "check_availability", arguments: { dateExpression: "Tuesday" } });
    await eventually(() => expect(value.execute).toHaveBeenCalledTimes(1));
    value.runtime.latestSession.emit({ type: "user.speech_started" });
    value.runtime.latestSession.emit({ type: "user.speech_stopped" });
    await eventually(() => expect(observed).toEqual(expect.arrayContaining(["tool.call", "tool.execution", "user.speech_started", "user.speech_stopped"])));

    resolveTool({ toolCallId: "calendar-1", ok: true, data: { earliestSlot: "2026-09-02T16:00:00.000Z" } });
    await eventually(() => expect(value.runtime.latestSession.receivedToolResults).toEqual([{
      toolCallId: "calendar-1", ok: true, data: { earliestSlot: "2026-09-02T16:00:00.000Z" },
    }]));
    await session.close();
  });

  it.each(["sí", "no"])("keeps a one-word '%s' turn when no assistant audio is playing", async () => {
    const value = fixture(stream(audio(1)));
    const session = await start(value);

    value.runtime.latestSession.emit({ type: "user.speech_started" });
    value.runtime.latestSession.emit({ type: "user.speech_stopped" });

    await eventually(() => expect(value.interruptPlayback).toHaveBeenCalledTimes(1));
    expect(value.runtime.latestSession.interruptCount).toBe(0);
    await session.close();
  });

  it("preserves server VAD boundaries for a correction followed by a long pause", async () => {
    const value = fixture();
    const observed: string[] = [];
    const session = await value.service.start({
      conversationId: "conversation-1",
      agent: value.agent,
      transport: value.transport,
      observeEvent: (event) => observed.push(event.type),
    });

    value.runtime.latestSession.emit({ type: "user.speech_started" });
    value.runtime.latestSession.emit({ type: "user.speech_stopped" });
    value.runtime.latestSession.emit({ type: "user.speech_started" });
    value.runtime.latestSession.emit({ type: "user.speech_stopped" });

    await eventually(() => expect(observed).toEqual([
      "user.speech_started",
      "user.speech_stopped",
      "user.speech_started",
      "user.speech_stopped",
    ]));
    await session.close();
  });

  it("does not invent a turn or interruption from silent audio frames", async () => {
    const value = fixture(stream(audio(0), audio(0), audio(0)));
    const session = await start(value);

    await eventually(() => expect(value.runtime.latestSession.receivedAudio).toHaveLength(3));
    expect(value.interruptPlayback).not.toHaveBeenCalled();
    expect(value.runtime.latestSession.interruptCount).toBe(0);
    await session.close();
  });

  it("preserves the server-side silence timeout event without freezing the conversation", async () => {
    const value = fixture();
    const observed: string[] = [];
    const session = await value.service.start({
      conversationId: "conversation-1", agent: value.agent, transport: value.transport,
      observeEvent: (event) => observed.push(event.type),
    });
    value.runtime.latestSession.emit({ type: "silence.timeout" });
    await eventually(() => expect(observed).toEqual(["silence.timeout"]));
    await session.close();
  });

  it("closes the runtime and transport only once when close is called twice", async () => {
    const value = fixture();
    const session = await start(value);

    await Promise.all([session.close(), session.close()]);

    expect(value.runtime.latestSession.closeCount).toBe(1);
    expect(value.closeTransport).toHaveBeenCalledTimes(1);
    await expect(session.completed).resolves.toEqual({ status: "closed" });
  });
});

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}
