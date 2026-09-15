import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenAIRealtimeAdapter,
  type RealtimeConnection,
  type RealtimeConnectionFactory,
} from "../../src/modules/conversation/index.js";

const agent = {
  instructions: "Help the caller schedule an appointment.",
  locale: "es-MX",
  conversation: { model: "gpt-realtime-2.1", maxOutputTokens: 512, reasoningEffort: "minimal" as const, turnDetection: {} },
  tools: [{
    name: "check_availability" as const,
    description: "Find available times",
    inputSchema: { type: "object", required: ["serviceId"] },
  }],
};

class FakeRealtimeConnection implements RealtimeConnection {
  readonly sent: unknown[] = [];
  closeCount = 0;
  private eventHandler?: (event: unknown) => void;
  private errorHandler?: (error: { message: string; code?: string }) => void;
  private closeHandler?: (reason?: string) => void;

  send(event: unknown): void { this.sent.push(event); }
  close(): void { this.closeCount += 1; }
  onEvent(handler: (event: unknown) => void): void { this.eventHandler = handler; }
  onError(handler: (error: { message: string; code?: string }) => void): void { this.errorHandler = handler; }
  onClose(handler: (reason?: string) => void): void { this.closeHandler = handler; }
  emit(event: unknown): void { this.eventHandler?.(event); }
  fail(error: { message: string; code?: string }): void { this.errorHandler?.(error); }
  disconnect(reason?: string): void { this.closeHandler?.(reason); }
}

function fixture() {
  const connection = new FakeRealtimeConnection();
  const connectedWith: Array<{ apiKey: string; model: string }> = [];
  const factory: RealtimeConnectionFactory = {
    connect: async (input) => { connectedWith.push(input); return connection; },
  };
  const logged: Array<{ message: string; code?: string; error?: string }> = [];
  const adapter = new OpenAIRealtimeAdapter({
    apiKey: "test-key",
    model: "gpt-realtime-2.1",
    mode: "text",
    connectionFactory: factory,
    logger: { error: (message, details) => logged.push({
      message,
      ...(details?.code ? { code: details.code } : {}),
      ...(details?.error ? { error: details.error } : {}),
    }) },
  });
  return { adapter, connectedWith, connection, logged };
}

const open = (value: ReturnType<typeof fixture>) => value.adapter.openSession({
  conversationId: "conversation-1",
  agent,
});

describe("OpenAIRealtimeAdapter", () => {
  afterEach(() => vi.useRealTimers());

  it("connects and configures a short, serial, text-only session", async () => {
    const value = fixture();

    await open(value);

    expect(value.connectedWith).toEqual([{ apiKey: "test-key", model: "gpt-realtime-2.1" }]);
    expect(value.connection.sent[0]).toMatchObject({
      type: "session.update",
      session: {
        type: "realtime",
        model: "gpt-realtime-2.1",
        output_modalities: ["text"],
        tools: [{ type: "function", name: "check_availability" }],
        tool_choice: "auto",
        parallel_tool_calls: false,
        max_output_tokens: 512,
        reasoning: { effort: "minimal" },
        tracing: null,
      },
    });
    const instructions = (value.connection.sent[0] as { session: { instructions: string } }).session.instructions;
    expect(instructions).toContain("Ask one question at a time");
    expect(instructions).toContain("'hold on'");
    expect(instructions).toContain("Silence, an idle timeout, unclear speech, maybe");
  });

  it.each(["text", "audio"] as const)("instructs %s replies to confirm success once using the booked local date/time", async mode => {
    const connection = new FakeRealtimeConnection();
    const adapter = new OpenAIRealtimeAdapter({ apiKey: "test-key", mode,
      connectionFactory: { connect: async () => connection } });
    const session = await adapter.openSession({ conversationId: "confirmation-instructions", agent });
    const instructions = (connection.sent[0] as { session: { instructions: string } }).session.instructions;
    expect(instructions).toContain("Only after create_appointment returns ok: true");
    expect(instructions).toContain("clearly tell the caller once that their appointment is confirmed");
    expect(instructions).toContain("using appointmentDisplay from that successful result");
    expect(instructions).toContain("If booking fails, never claim it is confirmed or booked");
    expect(instructions).toContain("do not repeat the announcement, ask for another confirmation");
    expect(instructions).toContain("confirm_appointment only records consent");
    await session.close();
  });

  it("configures speech-to-speech and translates PCM audio in both directions", async () => {
    const connection = new FakeRealtimeConnection();
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      model: "gpt-realtime-2.1",
      mode: "audio",
      connectionFactory: { connect: async () => connection },
    });
    const session = await open({ ...fixture(), adapter, connection });
    const events = session.events()[Symbol.asyncIterator]();

    expect(connection.sent[0]).toMatchObject({
      type: "session.update",
      session: {
        output_modalities: ["audio"],
        audio: {
          input: { format: { type: "audio/pcm", rate: 24_000 } },
          output: { format: { type: "audio/pcm", rate: 24_000 } },
        },
      },
    });
    const update = connection.sent[0] as {
      session: { audio: { input: { turn_detection: unknown } } };
    };
    expect(update.session.audio.input.turn_detection).toEqual({
      type: "server_vad",
      create_response: false,
      interrupt_response: false,
      idle_timeout_ms: null,
      silence_duration_ms: 650,
    });

    await session.sendAudio({
      data: new Uint8Array([1, 2, 3, 4]),
      codec: "pcm_s16le",
      sampleRate: 24_000,
      channels: 1,
    });
    expect(connection.sent.at(-1)).toEqual({
      type: "input_audio_buffer.append",
      audio: Buffer.from([1, 2, 3, 4]).toString("base64"),
    });

    connection.emit({
      type: "response.output_audio.delta",
      item_id: "assistant-1",
      content_index: 0,
      delta: Buffer.from([5, 6]).toString("base64"),
    });
    await expect(next(events)).resolves.toEqual({
      type: "audio.delta",
      assistantTurnId: "assistant-1",
      frame: {
        data: Buffer.from([5, 6]),
        codec: "pcm_s16le",
        sampleRate: 24_000,
        channels: 1,
      },
    });
  });

  it("forwards response completion and uses server idle timeout rather than a local response race", async () => {
    const value = fixture();
    const session = await open(value);
    const events = session.events()[Symbol.asyncIterator]();

    value.connection.emit({ type: "response.done", response: { status: "completed" } });
    await expect(events.next()).resolves.toMatchObject({ value: { type: "assistant.response_done", status: "completed" } });
  });

  it("rejects a short server-VAD trigger during assistant audio without cancelling the response", async () => {
    const connection = new FakeRealtimeConnection();
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      mode: "audio",
      connectionFactory: { connect: async () => connection },
    });
    const session = await open({ ...fixture(), adapter, connection });
    const events = session.events()[Symbol.asyncIterator]();

    connection.emit({
      type: "response.output_audio.delta",
      item_id: "assistant-1",
      content_index: 0,
      delta: Buffer.from([5, 6]).toString("base64"),
    });
    await next(events);
    connection.emit({ type: "input_audio_buffer.speech_started", event_id: "vad-echo" });
    await session.sendAudio(pcmFrame(0));
    connection.emit({ type: "input_audio_buffer.speech_stopped", event_id: "vad-echo-stop" });

    await expect(next(events)).resolves.toMatchObject({
      type: "barge_in.detected",
      accepted: false,
      reason: "speech_stopped_before_confirmation",
      serverVadEventId: "vad-echo",
    });
    expect(connection.sent.filter((event) => (event as { type?: string }).type === "response.cancel")).toEqual([]);
  });

  it("confirms a real phone interruption from speech frames received just before the delayed server-VAD start event", async () => {
    const connection = new FakeRealtimeConnection();
    const diagnostics: Array<{ message: string; details?: Record<string, unknown> }> = [];
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      mode: "audio",
      connectionFactory: { connect: async () => connection },
      logger: { info: (message, details) => diagnostics.push({ message, details }), error: () => undefined },
    });
    const session = await adapter.openSession({ conversationId: "conversation-1", agent });
    const events = session.events()[Symbol.asyncIterator]();

    connection.emit({ type: "response.output_audio.delta", item_id: "assistant-1", content_index: 0, delta: Buffer.from([5, 6]).toString("base64") });
    await next(events);
    await new Promise((resolve) => setTimeout(resolve, 130));

    // The RTP/Realtime event loop can deliver the source audio before the VAD
    // event. These 20 ms frames are a real caller speech interval, not silence.
    for (let frame = 0; frame < 12; frame += 1) await session.sendAudio(pcmFrame(3_000));
    connection.emit({ type: "input_audio_buffer.speech_started", event_id: "vad-delayed" });

    await expect(next(events)).resolves.toMatchObject({
      type: "barge_in.detected",
      accepted: true,
      reason: "sustained_speech_confirmed",
      maxRmsDuringSpeech: expect.any(Number),
      maxPeakDuringSpeech: expect.any(Number),
      totalSpeechDurationMs: 240,
      consecutiveAboveThresholdMs: 240,
    });
    await expect(next(events)).resolves.toMatchObject({ type: "user.speech_started" });
    expect(diagnostics).toContainEqual(expect.objectContaining({
      message: "telephony.barge_in.candidate",
      details: expect.objectContaining({ serverVadEventId: "vad-delayed", totalSpeechDurationMs: 240 }),
    }));
    expect(diagnostics).toContainEqual(expect.objectContaining({
      message: "telephony.barge_in.accepted",
      details: expect.objectContaining({ serverVadEventId: "vad-delayed", consecutiveAboveThresholdMs: 240 }),
    }));
  });

  it.each(Array.from({ length: 25 }, (_, i) => i))("preserves a confirmed interruption and resumes its committed turn #%i", async i => {
    const connection = new FakeRealtimeConnection();
    const logs: Array<{ message: string; details?: Record<string, unknown> }> = [];
    const adapter = new OpenAIRealtimeAdapter({ apiKey: "test", mode: "audio", connectionFactory: { connect: async () => connection }, logger: { error: () => {}, info: (message, details) => logs.push({ message, details }) } });
    const session = await adapter.openSession({ conversationId: `interrupt-${i}`, agent });
    connection.emit({ type: "response.created", response: { id: "proposal" } });
    connection.emit({ type: "response.output_audio.delta", item_id: "confirmation-question", delta: Buffer.from([1, 2]).toString("base64") });
    await new Promise(resolve => setTimeout(resolve, 130));
    for (let frame = 0; frame < 12 + i % 4; frame++) await session.sendAudio(pcmFrame(3000 + i * 50));
    connection.emit({ type: "input_audio_buffer.speech_started" });
    expect(logs.some(log => log.message === "telephony.barge_in.accepted")).toBe(true);
    await session.interrupt({ assistantTurnId: "confirmation-question", audioEndMs: 130 });
    connection.emit({ type: "response.done", response: { id: "proposal", status: "cancelled" } });
    connection.emit({ type: "input_audio_buffer.speech_stopped" });
    connection.emit({ type: "input_audio_buffer.committed", item_id: "actually-tuesday" });
    await new Promise(resolve => setTimeout(resolve, 110));
    expect(connection.sent.filter((e: any) => e.type === "response.cancel")).toHaveLength(1);
    expect(connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(1);
    expect(connection.sent.filter((e: any) => e.type === "input_audio_buffer.append")).toHaveLength(12 + i % 4);
    await session.close();
  });

  it("logs the Realtime lifecycle, audio appends, and safe provider event metadata", async () => {
    const connection = new FakeRealtimeConnection();
    const diagnostics: Array<{ message: string; details?: Record<string, unknown> }> = [];
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      mode: "audio",
      connectionFactory: { connect: async () => connection },
      logger: {
        info: (message, details) => diagnostics.push({ message, details }),
        error: () => undefined,
      },
    });
    const session = await adapter.openSession({ conversationId: "conversation-1", agent });

    await session.sendAudio({
      data: new Uint8Array([1, 2, 3, 4]),
      codec: "pcm_s16le",
      sampleRate: 24_000,
      channels: 1,
    });
    connection.emit({ type: "input_audio_buffer.speech_stopped", event_id: "event-stop", item_id: "item-user" });
    connection.emit({ type: "input_audio_buffer.committed", event_id: "event-commit", item_id: "item-user" });
    connection.emit({ type: "session.updated", event_id: "event-configured", session: { model: "gpt-realtime-2.1", output_modalities: ["audio"] } });
    connection.emit({ type: "response.created", event_id: "event-created", response: { id: "response-1" } });
    connection.emit({
      type: "response.output_audio.delta",
      event_id: "event-audio",
      response_id: "response-1",
      item_id: "assistant-1",
      delta: Buffer.from([5, 6, 7]).toString("base64"),
    });
    connection.emit({ type: "response.done", response: { status: "completed" } });

    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: "OpenAI Realtime connection starting", details: { model: "gpt-realtime-2.1", mode: "audio" } }),
      expect.objectContaining({ message: "OpenAI Realtime connection established" }),
      expect.objectContaining({ message: "OpenAI Realtime session.update sent" }),
      expect.objectContaining({ message: "OpenAI Realtime input_audio_buffer.append sent", details: expect.objectContaining({ bytes: 4 }) }),
      expect.objectContaining({ message: "OpenAI Realtime speech stopped" }),
      expect.objectContaining({ message: "OpenAI Realtime input audio buffer committed" }),
      expect.objectContaining({ message: "OpenAI Realtime session configuration accepted", details: expect.objectContaining({ model: "gpt-realtime-2.1" }) }),
      expect.objectContaining({ message: "OpenAI Realtime response created" }),
      expect.objectContaining({ message: "OpenAI Realtime response done" }),
      expect.objectContaining({ message: "OpenAI Realtime event received", details: expect.objectContaining({ type: "input_audio_buffer.speech_stopped" }) }),
      expect.objectContaining({ message: "OpenAI Realtime event received", details: expect.objectContaining({ type: "response.created" }) }),
      expect.objectContaining({ message: "OpenAI Realtime event received", details: expect.objectContaining({ type: "response.output_audio.delta", audioBytes: 3 }) }),
      expect.objectContaining({ message: "OpenAI Realtime event received", details: expect.objectContaining({ type: "response.done", status: "completed" }) }),
    ]));
  });

  it("passes explicitly configured server VAD parameters", async () => {
    const connection = new FakeRealtimeConnection();
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      mode: "audio",
      turnDetection: { threshold: 0.5, prefixPaddingMs: 300, silenceDurationMs: 500 },
      connectionFactory: { connect: async () => connection },
    });

    await open({ ...fixture(), adapter, connection });

    expect(connection.sent[0]).toMatchObject({
      session: { audio: { input: { turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
        create_response: false,
        interrupt_response: false,
        idle_timeout_ms: null,
      } } } },
    });
  });

  it("waits through the local patience window before requesting a response", async () => {
    vi.useFakeTimers();
    const connection = new FakeRealtimeConnection();
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      mode: "audio",
      turnDetection: { responseDelayMs: 350 },
      connectionFactory: { connect: async () => connection },
    });
    await open({ ...fixture(), adapter, connection });

    connection.emit({ type: "input_audio_buffer.speech_started", event_id: "start" });
    connection.emit({ type: "input_audio_buffer.speech_stopped", event_id: "stop" });
    expect(connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toEqual([]);

    await vi.advanceTimersByTimeAsync(349);
    expect(connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toEqual([]);
    connection.emit({ type: "input_audio_buffer.committed", event_id: "commit", item_id: "caller-1" });
    await vi.advanceTimersByTimeAsync(1);
    expect(connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toEqual([{ type: "response.create" }]);
  });

  it("uses a short 100 ms local grace window after the normal server-VAD silence", async () => {
    vi.useFakeTimers();
    const connection = new FakeRealtimeConnection();
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      mode: "audio",
      connectionFactory: { connect: async () => connection },
    });
    await open({ ...fixture(), adapter, connection });

    connection.emit({ type: "input_audio_buffer.speech_started", event_id: "start" });
    connection.emit({ type: "input_audio_buffer.speech_stopped", event_id: "stop" });
    connection.emit({ type: "input_audio_buffer.committed", event_id: "commit", item_id: "caller-1" });
    await vi.advanceTimersByTimeAsync(99);
    expect(connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toEqual([{ type: "response.create" }]);
  });

  it("reports a concise reason when VAD speech-stop has not yet produced a committed user item", async () => {
    vi.useFakeTimers();
    const connection = new FakeRealtimeConnection();
    const diagnostics: Array<{ message: string; details?: Record<string, unknown> }> = [];
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      mode: "audio",
      connectionFactory: { connect: async () => connection },
      logger: {
        info: (message, details) => diagnostics.push({ message, details }),
        error: () => undefined,
      },
    });
    await open({ ...fixture(), adapter, connection });

    connection.emit({ type: "input_audio_buffer.speech_started", event_id: "start" });
    connection.emit({ type: "input_audio_buffer.speech_stopped", event_id: "stop" });
    await vi.advanceTimersByTimeAsync(150);

    expect(diagnostics).toContainEqual(expect.objectContaining({
      message: "telephony.turn.user_audio_summary",
      details: expect.objectContaining({
        speechCommitted: false,
        responseRequested: false,
        failureReason: "awaiting_input_audio_buffer_commit",
      }),
    }));
    expect(connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toEqual([]);
  });

  it("returns to listening after telephone playback drains, then answers a committed caller turn", async () => {
    vi.useFakeTimers();
    const connection = new FakeRealtimeConnection();
    const diagnostics: Array<{ message: string; details?: Record<string, unknown> }> = [];
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      mode: "audio",
      connectionFactory: { connect: async () => connection },
      logger: {
        info: (message, details) => diagnostics.push({ message, details }),
        error: () => undefined,
      },
    });
    const session = await open({ ...fixture(), adapter, connection });

    connection.emit({ type: "response.created", response: { id: "greeting" } });
    connection.emit({
      type: "response.output_audio.delta",
      item_id: "greeting-audio",
      content_index: 0,
      delta: Buffer.from([1, 2]).toString("base64"),
    });
    connection.emit({ type: "response.done", response: { id: "greeting", status: "completed" } });
    session.assistantPlaybackEnded?.();

    expect(diagnostics).toContainEqual(expect.objectContaining({
      message: "telephony.conversation.invalid_state",
      details: expect.objectContaining({ currentTurnState: "assistant_speaking", correction: "listening" }),
    }));

    connection.emit({ type: "input_audio_buffer.speech_started", event_id: "friday-start" });
    connection.emit({ type: "input_audio_buffer.speech_stopped", event_id: "friday-stop" });
    connection.emit({ type: "input_audio_buffer.committed", event_id: "friday-commit", item_id: "friday-item" });
    await vi.advanceTimersByTimeAsync(150);

    expect(connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toEqual([{ type: "response.create" }]);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      message: "telephony.turn.response_decision",
      details: expect.objectContaining({ shouldCreateResponse: true, reason: "committed_turn_ready", currentTurnState: "listening" }),
    }));
  });

  it("keeps ten consecutive assistant-question and caller-answer turns out of stale assistant state", async () => {
    vi.useFakeTimers();
    const connection = new FakeRealtimeConnection();
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      mode: "audio",
      connectionFactory: { connect: async () => connection },
    });
    const session = await open({ ...fixture(), adapter, connection });

    connection.emit({ type: "response.created", response: { id: "greeting" } });
    connection.emit({ type: "response.output_audio.delta", item_id: "greeting-audio", content_index: 0, delta: Buffer.from([1, 2]).toString("base64") });
    connection.emit({ type: "response.done", response: { id: "greeting", status: "completed" } });
    session.assistantPlaybackEnded?.();

    for (let turn = 1; turn <= 10; turn += 1) {
      connection.emit({ type: "input_audio_buffer.speech_started", event_id: `answer-start-${turn}` });
      connection.emit({ type: "input_audio_buffer.speech_stopped", event_id: `answer-stop-${turn}` });
      connection.emit({ type: "input_audio_buffer.committed", event_id: `answer-commit-${turn}`, item_id: `answer-${turn}` });
      await vi.advanceTimersByTimeAsync(150);
      expect(connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toHaveLength(turn);

      connection.emit({ type: "response.created", response: { id: `reply-${turn}` } });
      connection.emit({ type: "response.output_audio.delta", item_id: `reply-audio-${turn}`, content_index: 0, delta: Buffer.from([1, 2]).toString("base64") });
      connection.emit({ type: "response.done", response: { id: `reply-${turn}`, status: "completed" } });
      session.assistantPlaybackEnded?.();
    }
  });

  it("does not respond when the caller resumes during the patience window", async () => {
    vi.useFakeTimers();
    const connection = new FakeRealtimeConnection();
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      mode: "audio",
      turnDetection: { responseDelayMs: 350 },
      connectionFactory: { connect: async () => connection },
    });
    await open({ ...fixture(), adapter, connection });

    connection.emit({ type: "input_audio_buffer.speech_started", event_id: "start" });
    connection.emit({ type: "input_audio_buffer.speech_stopped", event_id: "stop" });
    await vi.advanceTimersByTimeAsync(200);
    connection.emit({ type: "input_audio_buffer.speech_started", event_id: "resumed" });
    await vi.advanceTimersByTimeAsync(500);
    expect(connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toEqual([]);
  });

  it("creates exactly one response for each of twenty consecutive committed audio turns", async () => {
    vi.useFakeTimers();
    const connection = new FakeRealtimeConnection();
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      mode: "audio",
      turnDetection: { responseDelayMs: 350 },
      connectionFactory: { connect: async () => connection },
    });
    const session = await open({ ...fixture(), adapter, connection });

    for (let turn = 1; turn <= 20; turn += 1) {
      connection.emit({ type: "input_audio_buffer.speech_started", event_id: `start-${turn}` });
      await session.sendAudio(pcmFrame(3_000));
      connection.emit({ type: "input_audio_buffer.speech_stopped", event_id: `stop-${turn}` });
      connection.emit({ type: "input_audio_buffer.committed", event_id: `commit-${turn}`, item_id: `caller-${turn}` });
      await vi.advanceTimersByTimeAsync(350);

      const requests = connection.sent.filter((event) => (event as { type?: string }).type === "response.create");
      expect(requests).toHaveLength(turn);

      connection.emit({ type: "response.created", response: { id: `response-${turn}` } });
      connection.emit({ type: "response.done", response: { id: `response-${turn}`, status: "completed" } });
    }

    expect(connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toHaveLength(20);
  });

  it("reports a redacted provider error when the initial connection is rejected", async () => {
    const logged: Array<{ message: string; code?: string; error?: string }> = [];
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      connectionFactory: {
        connect: async () => {
          throw Object.assign(new Error("Incorrect API key sk-proj-secret-value"), {
            error: { code: "invalid_api_key", message: "Incorrect API key sk-proj-secret-value" },
          });
        },
      },
      logger: { error: (message, details) => logged.push({ message, ...details }) },
    });

    await expect(open({ ...fixture(), adapter })).rejects.toThrow("Incorrect API key");
    expect(logged).toEqual([{
      message: "OpenAI Realtime WebSocket connection failed",
      code: "invalid_api_key",
      error: "Incorrect API key [redacted]",
    }]);
  });

  it("redacts an invalid API-key value even when it does not use the usual key prefix", async () => {
    const logged: Array<{ message: string; code?: string; error?: string }> = [];
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      connectionFactory: {
        connect: async () => {
          throw Object.assign(new Error("Incorrect API key provided: accidental-password"), {
            error: { code: "invalid_api_key", message: "Incorrect API key provided: accidental-password" },
          });
        },
      },
      logger: { error: (message, details) => logged.push({ message, ...details }) },
    });

    await expect(open({ ...fixture(), adapter })).rejects.toThrow("Incorrect API key");
    expect(logged[0]?.error).toBe("Incorrect API key provided: [redacted]");
  });

  it("sends a text turn and translates streamed and final text", async () => {
    const value = fixture();
    const session = await open(value);
    const events = session.events()[Symbol.asyncIterator]();

    await session.sendText("¿Qué horarios hay mañana?");
    value.connection.emit({ type: "response.output_text.delta", delta: "Tengo " });
    value.connection.emit({ type: "response.output_text.done", text: "Tengo disponibilidad." });

    expect(value.connection.sent.slice(1)).toEqual([
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "¿Qué horarios hay mañana?" }],
        },
      },
      { type: "response.create" },
    ]);
    await expect(next(events)).resolves.toEqual({ type: "assistant.transcript", text: "Tengo ", final: false });
    await expect(next(events)).resolves.toEqual({ type: "assistant.transcript", text: "Tengo disponibilidad.", final: true });
  });

  it("does not replay a finished greeting on session updates or playback callbacks", async () => {
    vi.useFakeTimers();
    const value = fixture();
    const session = await open(value);
    await session.startGreeting?.();
    value.connection.emit({ type: "session.updated" });
    value.connection.emit({ type: "response.created", response: { id: "greeting" } });
    value.connection.emit({ type: "response.done", response: { id: "greeting", status: "completed" } });
    for (let i = 0; i < 5; i++) {
      value.connection.emit({ type: "session.updated" });
      session.assistantPlaybackEnded?.();
      await session.startGreeting?.();
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(value.connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(1);
    await session.close();
  });

  it("disables provider idle prompts and stays quiet after its question", async () => {
    vi.useFakeTimers();
    const connection = new FakeRealtimeConnection();
    const adapter = new OpenAIRealtimeAdapter({ apiKey: "test", mode: "audio", connectionFactory: { connect: async () => connection }, logger: { error: () => {}, info: () => {} } });
    const session = await adapter.openSession({ conversationId: "silent", agent });
    expect(connection.sent[0]).toMatchObject({ session: { audio: { input: { turn_detection: { idle_timeout_ms: null, create_response: false } } } } });
    await session.startGreeting?.();
    connection.emit({ type: "session.updated" });
    connection.emit({ type: "response.created", response: { id: "greeting" } });
    connection.emit({ type: "response.output_audio.delta", item_id: "question", delta: Buffer.from([1, 2]).toString("base64") });
    connection.emit({ type: "response.done", response: { id: "greeting", status: "completed" } });
    session.assistantPlaybackEnded?.();
    for (const silence of [1000, 2000, 8000, 30000]) {
      await vi.advanceTimersByTimeAsync(silence);
      connection.emit({ type: "input_audio_buffer.timeout_triggered" });
      connection.emit({ type: "input_audio_buffer.committed", item_id: "empty-timeout" });
      expect(connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(1);
    }
    connection.emit({ type: "input_audio_buffer.speech_started" });
    connection.emit({ type: "input_audio_buffer.speech_stopped" });
    connection.emit({ type: "input_audio_buffer.committed", item_id: "tuesday" });
    await vi.advanceTimersByTimeAsync(100);
    expect(connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(2);
    await session.close();
  });

  it("cancels generation on caller speech even before a playback position exists", async () => {
    const value = fixture();
    const session = await open(value);
    value.connection.emit({ type: "response.created", response: { id: "stale" } });
    value.connection.emit({ type: "input_audio_buffer.speech_started" });
    await session.interrupt();
    value.connection.emit({ type: "response.output_audio.delta", response_id: "stale", item_id: "late", delta: "AQI=" });
    expect(value.connection.sent.filter((e: any) => e.type === "response.cancel")).toHaveLength(1);
    await session.close();
    const received = [];
    for await (const event of session.events()) received.push(event.type);
    expect(received).not.toContain("audio.delta");
  });

  it("cancels a late response acknowledgement even when the short caller answer has ended", async () => {
    vi.useFakeTimers();
    const value = fixture();
    const session = await open(value);
    await session.sendText("previous turn");
    value.connection.emit({ type: "input_audio_buffer.speech_started" });
    value.connection.emit({ type: "input_audio_buffer.speech_stopped" });
    value.connection.emit({ type: "input_audio_buffer.committed", item_id: "tuesday" });
    await vi.advanceTimersByTimeAsync(100);
    value.connection.emit({ type: "response.created", response: { id: "late-old-response" } });
    expect(value.connection.sent.filter((e: any) => e.type === "response.cancel")).toHaveLength(1);
    value.connection.emit({ type: "response.done", response: { id: "late-old-response", status: "cancelled" } });
    expect(value.connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(2);
    await session.close();
  });

  it.each(["greeting", "date", "time", "availability", "confirmation", "booking-success"])("waits quietly after %s, then allows a slow answer and a resumed phrase", async stage => {
    vi.useFakeTimers();
    const value = fixture();
    const session = await open(value);
    value.connection.emit({ type: "response.created", response: { id: stage } });
    value.connection.emit({ type: "response.done", response: { id: stage, status: "completed" } });
    await vi.advanceTimersByTimeAsync(60000);
    expect(value.connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(0);
    value.connection.emit({ type: "input_audio_buffer.speech_started" });
    await vi.advanceTimersByTimeAsync(10000);
    expect(value.connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(0);
    value.connection.emit({ type: "input_audio_buffer.speech_stopped" });
    value.connection.emit({ type: "input_audio_buffer.committed", item_id: "first-phrase" });
    await vi.advanceTimersByTimeAsync(50);
    value.connection.emit({ type: "input_audio_buffer.speech_started" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(value.connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(0);
    value.connection.emit({ type: "input_audio_buffer.speech_stopped" });
    value.connection.emit({ type: "input_audio_buffer.committed", item_id: "second-phrase" });
    await vi.advanceTimersByTimeAsync(100);
    expect(value.connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(1);
    await session.close();
  });

  it("does not turn replayed input boundary events into a second caller turn", async () => {
    vi.useFakeTimers();
    const value = fixture();
    const session = await open(value);
    const boundaries = [
      { type: "input_audio_buffer.speech_started", event_id: "start-1" },
      { type: "input_audio_buffer.speech_stopped", event_id: "stop-1" },
      { type: "input_audio_buffer.committed", event_id: "commit-1", item_id: "tuesday" },
    ];
    boundaries.forEach(e => value.connection.emit(e));
    await vi.advanceTimersByTimeAsync(100);
    value.connection.emit({ type: "response.created", response: { id: "answer" } });
    value.connection.emit({ type: "response.done", response: { id: "answer", status: "completed" } });
    boundaries.forEach(e => value.connection.emit(e));
    await vi.advanceTimersByTimeAsync(100);
    expect(value.connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(1);
    await session.close();
  });

  it("starts exactly one greeting without requiring caller audio", async () => {
    const value = fixture();
    const session = await open(value);

    await session.startGreeting?.();
    expect(value.connection.sent.slice(1)).toEqual([]);
    value.connection.emit({ type: "session.updated", session: { model: "gpt-realtime-2.1" } });
    await session.startGreeting?.();

    expect(value.connection.sent.slice(1)).toEqual([{
      type: "response.create",
      response: {
        instructions: "Say exactly: Hi, thanks for calling. This is YIBO, the AI receptionist. What day would you like to come in? Then wait for the caller's answer.",
      },
    }]);
  });

  it("translates a function call without trusting its JSON arguments", async () => {
    const value = fixture();
    const session = await open(value);
    const events = session.events()[Symbol.asyncIterator]();

    value.connection.emit({
      type: "response.function_call_arguments.done",
      call_id: "tool-1",
      name: "check_availability",
      arguments: '{"serviceId":"consultation","tenantId":"untrusted"}',
    });

    await expect(next(events)).resolves.toEqual({
      type: "tool.call",
      toolCallId: "tool-1",
      name: "check_availability",
      arguments: { serviceId: "consultation", tenantId: "untrusted" },
    });
  });

  it("resumes a short committed answer when the preceding response finally completes", async () => {
    vi.useFakeTimers();
    const value = fixture();
    const session = await open(value);
    value.connection.emit({ type: "response.created", response: { id: "proposal" } });
    value.connection.emit({ type: "input_audio_buffer.speech_started" });
    value.connection.emit({ type: "input_audio_buffer.speech_stopped" });
    value.connection.emit({ type: "input_audio_buffer.committed", item_id: "yes" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(value.connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(0);
    value.connection.emit({ type: "response.done", response: { id: "proposal", status: "completed" } });
    expect(value.connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(1);
    await session.close();
  });

  it("ignores tool replay after the original result was returned", async () => {
    const value = fixture();
    const session = await open(value);
    const event = { type: "response.function_call_arguments.done", call_id: "replay", name: "check_availability", arguments: "{}" };
    value.connection.emit(event);
    await session.sendToolResult({ toolCallId: "replay", ok: true, data: {} });
    value.connection.emit(event);
    await session.sendToolResult({ toolCallId: "replay", ok: true, data: {} });
    expect(value.connection.sent.filter((e: any) => e.item?.type === "function_call_output")).toHaveLength(1);
    await session.close();
  });

  it.each(Array.from({ length: 50 }, (_, i) => i))("commits short answer audio through normal turn handling #%i", async i => {
    vi.useFakeTimers();
    const connection = new FakeRealtimeConnection();
    const logs: Array<{ message: string; details?: Record<string, unknown> }> = [];
    const adapter = new OpenAIRealtimeAdapter({ apiKey: "test", mode: "audio",
      connectionFactory: { connect: async () => connection },
      logger: { error: () => {}, info: (message, details) => logs.push({ message, details }) },
    });
    const session = await adapter.openSession({ conversationId: `short-${i}`, agent });
    connection.emit({ type: "input_audio_buffer.speech_started" });
    const durationMs = 60 + i * 4;
    await session.sendAudio({ data: new Uint8Array(durationMs * 48), codec: "pcm_s16le", sampleRate: 24000, channels: 1 });
    connection.emit({ type: "input_audio_buffer.speech_stopped" });
    if (i % 2) await vi.advanceTimersByTimeAsync(110);
    connection.emit({ type: "input_audio_buffer.committed", item_id: `yes-${i}` });
    connection.emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "Yes.", item_id: `yes-${i}` });
    await vi.advanceTimersByTimeAsync(110);
    expect(connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(1);
    expect(logs).toContainEqual({ message: "telephony.turn.user_audio_summary", details: expect.objectContaining({ audioDurationMs: durationMs, speechCommitted: true, responseRequested: true }) });
    await session.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(Array.from({ length: 25 }, (_, i) => i))("resumes once across tool-output and caller-turn ordering #%i", async i => {
    vi.useFakeTimers();
    const value = fixture();
    const session = await open(value);
    value.connection.emit({ type: "response.created", response: { id: "old" } });
    value.connection.emit({ type: "response.function_call_arguments.done", call_id: "tool", name: "check_availability", arguments: "{}" });
    value.connection.emit({ type: "input_audio_buffer.speech_started" });
    value.connection.emit({ type: "input_audio_buffer.speech_stopped" });
    value.connection.emit({ type: "input_audio_buffer.committed" });
    await vi.advanceTimersByTimeAsync(100 + i);
    const done = () => value.connection.emit({ type: "response.done", response: { id: "old", status: "completed" } });
    if (i % 2) done();
    await session.sendToolResult({ toolCallId: "tool", ok: true, data: {} });
    done();
    expect(value.connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(1);
    value.connection.emit({ type: "response.created", response: { id: "new" } });
    done();
    await vi.advanceTimersByTimeAsync(4000);
    expect(value.connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(1);
    await session.close();
  });

  it.each(Array.from({ length: 25 }, (_, i) => i))("booking watchdog only recovers speech once #%i", async i => {
    vi.useFakeTimers();
    const value = fixture();
    const session = await value.adapter.openSession({ conversationId: `watchdog-${i}`, agent: { ...agent, tools: [{ ...agent.tools[0]!, name: "create_appointment" }] } });
    value.connection.emit({ type: "response.function_call_arguments.done", call_id: "book", name: "create_appointment", arguments: "{}" });
    await session.sendToolResult(i % 2 ? { toolCallId: "book", ok: true, data: { appointment: { status: "CONFIRMED" } } } : { toolCallId: "book", ok: false, error: { code: "FAILED", message: "Failed", retryable: false } });
    // Recovery is safe only after the original request has finished, not merely
    // because its acknowledgement is slow (which could duplicate a response).
    value.connection.emit({ type: "response.created", response: { id: "silent-result" } });
    value.connection.emit({ type: "response.done", response: { id: "silent-result", status: "completed" } });
    await vi.advanceTimersByTimeAsync(3500 + i);
    const requests = value.connection.sent.filter((e: any) => e.type === "response.create") as any[];
    expect(requests).toHaveLength(2);
    expect(requests[1].response.tool_choice).toBe("none");
    expect(requests[1].response.instructions).toContain("Only after create_appointment returns ok: true");
    expect(requests[1].response.instructions).toContain("do not repeat the announcement, ask for another confirmation");
    expect(requests[1].response.instructions).toContain("If booking fails, never claim it is confirmed or booked");
    await vi.advanceTimersByTimeAsync(20000);
    expect(value.connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(2);
    expect(value.connection.sent.filter((e: any) => e.item?.type === "function_call_output")).toHaveLength(1);
    await session.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the booking watchdog after a text-mode reply", async () => {
    vi.useFakeTimers();
    const value = fixture();
    const session = await value.adapter.openSession({ conversationId: "text-booking", agent: { ...agent, tools: [{ ...agent.tools[0]!, name: "create_appointment" }] } });
    value.connection.emit({ type: "response.function_call_arguments.done", call_id: "book", name: "create_appointment", arguments: "{}" });
    await session.sendToolResult({ toolCallId: "book", ok: true, data: { appointmentDisplay: "Monday, August 10, 2026 at 9:00 AM" } });
    value.connection.emit({ type: "response.created", response: { id: "reply" } });
    value.connection.emit({ type: "response.output_text.delta", delta: "Your appointment is confirmed for Monday, August 10, 2026 at 9:00 AM." });
    value.connection.emit({ type: "response.done", response: { id: "reply", status: "completed" } });
    await session.sendToolResult({ toolCallId: "book", ok: true, data: { appointmentDisplay: "Monday, August 10, 2026 at 9:00 AM" } });
    await vi.advanceTimersByTimeAsync(10000);
    expect(value.connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(1);
    await session.close();
  });

  it("surfaces provider failure after the single booking recovery also fails", async () => {
    vi.useFakeTimers();
    const value = fixture();
    const session = await value.adapter.openSession({ conversationId: "provider-failure", agent: { ...agent, tools: [{ ...agent.tools[0]!, name: "create_appointment" }] } });
    value.connection.emit({ type: "response.function_call_arguments.done", call_id: "book", name: "create_appointment", arguments: "{}" });
    await session.sendToolResult({ toolCallId: "book", ok: true, data: { appointmentDisplay: "Monday, August 10, 2026 at 9:00 AM" } });
    value.connection.emit({ type: "response.created", response: { id: "first" } });
    value.connection.emit({ type: "response.done", response: { id: "first", status: "failed", status_details: { type: "failed", error: { code: "rate_limit_exceeded", message: "Try again later" } } } });
    await vi.advanceTimersByTimeAsync(3500);
    value.connection.emit({ type: "response.created", response: { id: "recovery" } });
    value.connection.emit({ type: "response.done", response: { id: "recovery", status: "failed" } });
    const events = session.events()[Symbol.asyncIterator]();
    let error: unknown;
    for (let i = 0; i < 6; i++) {
      const event = await next(events);
      if (event.type === "error") { error = event; break; }
    }
    expect(error).toMatchObject({ type: "error", code: "REALTIME_RESPONSE_FAILED" });
    expect(value.connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(2);
    expect(value.connection.sent.filter((e: any) => e.item?.type === "function_call_output")).toHaveLength(1);
    await session.close();
  });

  it("starts 50 sequential connections with clean greeting and tool replay state", async () => {
    for (let i = 0; i < 50; i++) {
      const value = fixture();
      const session = await open(value);
      value.connection.emit({ type: "session.updated" });
      await session.startGreeting?.();
      value.connection.emit({ type: "response.created", response: { id: "greeting" } });
      value.connection.emit({ type: "response.done", response: { id: "greeting", status: "completed" } });
      value.connection.emit({ type: "response.function_call_arguments.done", call_id: "same-id-new-call", name: "check_availability", arguments: "{}" });
      await session.sendToolResult({ toolCallId: "same-id-new-call", ok: true, data: {} });
      expect(value.connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(2);
      expect(value.connection.sent.filter((e: any) => e.item?.type === "function_call_output")).toHaveLength(1);
      await session.close();
      await session.close();
      expect(value.connection.closeCount).toBe(1);
    }
  });

  it.each([50, 100])("maintains one response per turn over %i turns", async turns => {
    vi.useFakeTimers();
    const value = fixture();
    const session = await open(value);
    for (let i = 0; i < turns; i++) {
      value.connection.emit({ type: "input_audio_buffer.speech_started" });
      value.connection.emit({ type: "input_audio_buffer.speech_stopped" });
      value.connection.emit({ type: "input_audio_buffer.committed", item_id: `turn-${i}` });
      await vi.advanceTimersByTimeAsync(100);
      expect(value.connection.sent.filter((e: any) => e.type === "response.create")).toHaveLength(i + 1);
      value.connection.emit({ type: "response.created", response: { id: `r-${i}` } });
      value.connection.emit({ type: "response.done", response: { id: `r-${i}`, status: "completed" } });
      expect(vi.getTimerCount()).toBe(0);
    }
    await session.close();
  });

  it("returns a correlated tool result and asks for the next response", async () => {
    const value = fixture();
    const session = await open(value);

    await session.sendToolResult({
      toolCallId: "tool-1",
      ok: true,
      data: { slots: ["16:30", "17:15"] },
    });

    expect(value.connection.sent.slice(1)).toEqual([
      {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: "tool-1",
          output: JSON.stringify({ ok: true, data: { slots: ["16:30", "17:15"] } }),
        },
      },
      { type: "response.create" },
    ]);
  });

  it("continues exactly once after a tool result arrives before its response is done", async () => {
    const value = fixture();
    const session = await open(value);

    value.connection.emit({ type: "response.created", response: { id: "response-calendar" } });
    await session.sendToolResult({
      toolCallId: "calendar-1",
      ok: true,
      data: { earliestSlot: "2026-09-02T16:00:00.000Z" },
    });

    // The provider still owns this response, so a second response is unsafe
    // until it reports completion.
    expect(value.connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toEqual([]);

    value.connection.emit({ type: "response.done", response: { id: "response-calendar", status: "completed" } });
    expect(value.connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toEqual([
      { type: "response.create" },
    ]);

    // Duplicate completion events must not create another assistant turn.
    value.connection.emit({ type: "response.done", response: { id: "response-calendar", status: "completed" } });
    expect(value.connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toHaveLength(1);
  });

  it("queues a tool result while a response create acknowledgement is pending", async () => {
    const value = fixture();
    const session = await open(value);

    await session.sendText("I need Friday.");
    await session.sendToolResult({ toolCallId: "availability-after-change", ok: true, data: { slots: [] } });
    expect(value.connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toHaveLength(1);

    value.connection.emit({ type: "response.created", response: { id: "caller-turn" } });
    value.connection.emit({ type: "response.done", response: { id: "caller-turn", status: "completed" } });
    expect(value.connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toHaveLength(2);
  });

  it("uses one central response path after a confirmation-style tool result and ignores stale completion events", async () => {
    const value = fixture();
    const session = await open(value);
    const events = session.events()[Symbol.asyncIterator]();

    value.connection.emit({ type: "response.created", response: { id: "offer-friday" } });
    value.connection.emit({
      type: "response.function_call_arguments.done",
      call_id: "confirm-friday-930",
      name: "check_availability",
      arguments: '{"serviceId":"consultation"}',
    });
    await expect(next(events)).resolves.toMatchObject({ type: "assistant.response_created", responseId: "offer-friday" });
    await expect(next(events)).resolves.toMatchObject({ type: "tool.call", toolCallId: "confirm-friday-930" });

    // The offer response can finish while the tool is still executing. That
    // leaves the single central state machine in tool_running, not listening.
    value.connection.emit({ type: "response.done", response: { id: "offer-friday", status: "completed" } });
    await session.sendToolResult({ toolCallId: "confirm-friday-930", ok: true, data: { confirmed: true } });
    expect(value.connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toEqual([
      { type: "response.create" },
    ]);

    // Acknowledging the post-tool response must make a late duplicate of the
    // old completion harmless; it must not clear or duplicate the new turn.
    value.connection.emit({ type: "response.created", response: { id: "booking-result" } });
    value.connection.emit({ type: "response.done", response: { id: "offer-friday", status: "completed" } });
    expect(value.connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toHaveLength(1);

    value.connection.emit({ type: "response.done", response: { id: "booking-result", status: "completed" } });
    expect(value.connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toHaveLength(1);
  });

  it("keeps tool_running authoritative when playback drains before the confirmation tool returns", async () => {
    const connection = new FakeRealtimeConnection();
    const diagnostics: Array<{ message: string; details?: Record<string, unknown> }> = [];
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      mode: "audio",
      connectionFactory: { connect: async () => connection },
      logger: { info: (message, details) => diagnostics.push({ message, details }), error: () => undefined },
    });
    const session = await adapter.openSession({ conversationId: "conversation-1", agent });

    connection.emit({ type: "response.created", response: { id: "offer" } });
    connection.emit({ type: "response.output_audio.delta", item_id: "offer-audio", content_index: 0, delta: Buffer.from([1, 2]).toString("base64") });
    connection.emit({ type: "response.function_call_arguments.done", call_id: "confirm", name: "check_availability", arguments: '{"serviceId":"consultation"}' });
    connection.emit({ type: "response.done", response: { id: "offer", status: "completed" } });
    session.assistantPlaybackEnded?.();

    expect(diagnostics).toContainEqual(expect.objectContaining({
      message: "OpenAI Realtime turn state changed",
      details: expect.objectContaining({ from: "assistant_speaking", to: "tool_running", activeToolCalls: 1 }),
    }));
  });

  it("does not execute a replayed confirmation tool call twice", async () => {
    const value = fixture();
    const session = await open(value);
    const events = session.events()[Symbol.asyncIterator]();
    const event = {
      type: "response.function_call_arguments.done",
      call_id: "confirm-once",
      name: "check_availability",
      arguments: '{"serviceId":"consultation"}',
    };

    value.connection.emit(event);
    value.connection.emit(event);

    await expect(next(events)).resolves.toMatchObject({ type: "tool.call", toolCallId: "confirm-once" });
    await session.sendToolResult({ toolCallId: "confirm-once", ok: true, data: { confirmed: true } });
    expect(value.connection.sent.filter((sent) => (sent as { type?: string }).type === "response.create")).toHaveLength(1);
  });

  it("does not create a competing response when a calendar result arrives after barge-in", async () => {
    const connection = new FakeRealtimeConnection();
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      mode: "audio",
      connectionFactory: { connect: async () => connection },
    });
    const session = await open({ ...fixture(), adapter, connection });

    connection.emit({ type: "response.created", response: { id: "response-1" } });
    connection.emit({ type: "input_audio_buffer.speech_started" });
    await session.interrupt({ assistantTurnId: "assistant-1", audioEndMs: 320 });
    connection.emit({ type: "response.done", response: { id: "response-1", status: "cancelled" } });

    await session.sendToolResult({
      toolCallId: "calendar-1",
      ok: true,
      data: { earliestSlot: "2026-09-02T16:00:00.000Z" },
    });

    expect(connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toEqual([]);
    expect(connection.sent).toContainEqual({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: "calendar-1",
        output: JSON.stringify({ ok: true, data: { earliestSlot: "2026-09-02T16:00:00.000Z" } }),
      },
    });

    connection.emit({ type: "input_audio_buffer.speech_stopped" });
    connection.emit({ type: "response.created", response: { id: "response-2" } });
    connection.emit({ type: "response.done", response: { id: "response-2", status: "completed" } });

    expect(connection.sent.filter((event) => (event as { type?: string }).type === "response.create")).toEqual([]);
  });

  it("logs and translates connection errors", async () => {
    const value = fixture();
    const session = await open(value);
    const events = session.events()[Symbol.asyncIterator]();

    value.connection.fail({ code: "rate_limit_exceeded", message: "Capacity exceeded" });

    expect(value.logged).toEqual([{
      message: "OpenAI Realtime WebSocket error",
      code: "rate_limit_exceeded",
      error: "Capacity exceeded",
    }]);
    await expect(next(events)).resolves.toEqual({
      type: "error",
      code: "rate_limit_exceeded",
      message: "Capacity exceeded",
      retryable: true,
    });
  });

  it("logs and translates provider error events", async () => {
    const value = fixture();
    const session = await open(value);
    const events = session.events()[Symbol.asyncIterator]();

    value.connection.emit({
      type: "error",
      error: { code: "invalid_request_error", message: "Invalid session configuration" },
    });

    expect(value.logged).toEqual([{
      message: "OpenAI Realtime WebSocket error",
      code: "invalid_request_error",
      error: "Invalid session configuration",
    }]);
    await expect(next(events)).resolves.toEqual({
      type: "error",
      code: "invalid_request_error",
      message: "Invalid session configuration",
      retryable: true,
    });
  });

  it("translates an unexpected disconnect to a closed event", async () => {
    const value = fixture();
    const session = await open(value);
    const events = session.events()[Symbol.asyncIterator]();

    value.connection.disconnect("network_lost");

    await expect(next(events)).resolves.toEqual({ type: "closed", reason: "network_lost" });
  });

  it("cancels only after YIBO accepts a local barge-in and truncates playback exactly once", async () => {
    const value = fixture();
    const session = await open(value);
    const events = session.events()[Symbol.asyncIterator]();

    value.connection.emit({ type: "response.created", response: { id: "response-1" } });
    await expect(next(events)).resolves.toEqual({ type: "assistant.response_created", responseId: "response-1" });
    await session.interrupt({ assistantTurnId: "assistant-1", audioEndMs: 1234.4 });
    await session.interrupt({ assistantTurnId: "assistant-1", audioEndMs: 1400 });
    await session.close();
    await session.close();

    expect(value.connection.sent.filter((event) => (event as { type?: string }).type === "response.cancel")).toEqual([{ type: "response.cancel" }]);
    expect(value.connection.sent.filter((event) => (event as { type?: string }).type === "conversation.item.truncate")).toEqual([{
      type: "conversation.item.truncate",
      item_id: "assistant-1",
      content_index: 0,
      audio_end_ms: 1234,
    }]);
    expect(value.connection.closeCount).toBe(1);
    await expect(next(events)).resolves.toEqual({ type: "closed", reason: "client_closed" });
  });

  it("clears telephone playback after response completion without sending an invalid response.cancel", async () => {
    const value = fixture();
    const session = await open(value);

    value.connection.emit({ type: "response.created", response: { id: "response-1" } });
    value.connection.emit({ type: "response.done", response: { id: "response-1", status: "completed" } });
    await session.interrupt({ assistantTurnId: "assistant-1", audioEndMs: 320 });

    expect(value.connection.sent.filter((event) => (event as { type?: string }).type === "response.cancel")).toEqual([]);
    expect(value.connection.sent.filter((event) => (event as { type?: string }).type === "conversation.item.truncate")).toEqual([{ type: "conversation.item.truncate", item_id: "assistant-1", content_index: 0, audio_end_ms: 320 }]);
  });

  it("confirms a real interruption during queued telephone playback without cancelling a completed response", async () => {
    const connection = new FakeRealtimeConnection();
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key",
      mode: "audio",
      connectionFactory: { connect: async () => connection },
    });
    const session = await adapter.openSession({ conversationId: "conversation-1", agent });
    const events = session.events()[Symbol.asyncIterator]();

    connection.emit({ type: "response.created", response: { id: "response-1" } });
    await next(events);
    connection.emit({
      type: "response.output_audio.delta",
      item_id: "assistant-1",
      content_index: 0,
      delta: Buffer.from([5, 6]).toString("base64"),
    });
    await next(events);
    connection.emit({ type: "response.done", response: { id: "response-1", status: "completed" } });
    await next(events);

    connection.emit({ type: "input_audio_buffer.speech_started", event_id: "vad-after-done" });
    await new Promise((resolve) => setTimeout(resolve, 130));
    for (let frame = 0; frame < 18; frame += 1) await session.sendAudio(pcmFrame(3_000));

    await expect(next(events)).resolves.toMatchObject({
      type: "barge_in.detected",
      accepted: true,
      realtimeResponseActive: false,
      reason: "sustained_speech_confirmed",
    });
    await expect(next(events)).resolves.toMatchObject({ type: "user.speech_started" });
    await session.interrupt({ assistantTurnId: "assistant-1", audioEndMs: 360 });

    expect(connection.sent.filter((event) => (event as { type?: string }).type === "response.cancel")).toEqual([]);
    expect(connection.sent.filter((event) => (event as { type?: string }).type === "conversation.item.truncate")).toEqual([{ type: "conversation.item.truncate", item_id: "assistant-1", content_index: 0, audio_end_ms: 360 }]);
  });
});

async function next(
  events: AsyncIterator<import("../../src/modules/conversation/index.js").ConversationRuntimeEvent>,
) {
  const result = await events.next();
  if (result.done) throw new Error("Expected a conversation event");
  return result.value;
}

function pcmFrame(amplitude: number) {
  const data = new Uint8Array(960);
  const view = new DataView(data.buffer);
  for (let index = 0; index < 480; index += 1) view.setInt16(index * 2, amplitude, true);
  return { data, codec: "pcm_s16le", sampleRate: 24_000, channels: 1 } as const;
}
