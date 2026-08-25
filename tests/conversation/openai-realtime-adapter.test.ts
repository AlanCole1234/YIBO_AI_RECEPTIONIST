import { describe, expect, it } from "vitest";
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
  const logged: Array<{ message: string; code?: string }> = [];
  const adapter = new OpenAIRealtimeAdapter({
    apiKey: "test-key",
    model: "gpt-realtime-2.1",
    mode: "text",
    connectionFactory: factory,
    logger: { error: (message, details) => logged.push({ message, ...(details?.code ? { code: details.code } : {}) }) },
  });
  return { adapter, connectedWith, connection, logged };
}

const open = (value: ReturnType<typeof fixture>) => value.adapter.openSession({
  conversationId: "conversation-1",
  agent,
});

describe("OpenAIRealtimeAdapter", () => {
  it("connects and configures a short, serial, text-only session", async () => {
    const value = fixture();

    await open(value);

    expect(value.connectedWith).toEqual([{ apiKey: "test-key", model: "gpt-realtime-2.1" }]);
    expect(value.connection.sent[0]).toEqual({
      type: "session.update",
      session: {
        type: "realtime",
        model: "gpt-realtime-2.1",
        output_modalities: ["text"],
        instructions: [
          "Help the caller schedule an appointment.",
          "Keep responses concise, but always finish the current sentence naturally.",
          "Speak warmly and conversationally, with natural phrasing and without sounding scripted.",
        ].join("\n"),
        tools: [{
          type: "function",
          name: "check_availability",
          description: "Find available times",
          parameters: { type: "object", required: ["serviceId"] },
        }],
        tool_choice: "auto",
        parallel_tool_calls: false,
        max_output_tokens: 512,
        reasoning: { effort: "minimal" },
        tracing: null,
      },
    });
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
      create_response: true,
      interrupt_response: false,
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
        create_response: true,
        interrupt_response: false,
      } } } },
    });
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

  it("logs and translates connection errors", async () => {
    const value = fixture();
    const session = await open(value);
    const events = session.events()[Symbol.asyncIterator]();

    value.connection.fail({ code: "rate_limit_exceeded", message: "Capacity exceeded" });

    expect(value.logged).toEqual([{
      message: "OpenAI Realtime WebSocket error",
      code: "rate_limit_exceeded",
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

  it("interrupts and closes the WebSocket idempotently", async () => {
    const value = fixture();
    const session = await open(value);
    const events = session.events()[Symbol.asyncIterator]();

    await session.interrupt({ assistantTurnId: "assistant-1", audioEndMs: 1234.4 });
    await session.close();
    await session.close();

    expect(value.connection.sent.slice(-2)).toEqual([
      { type: "response.cancel" },
      {
        type: "conversation.item.truncate",
        item_id: "assistant-1",
        content_index: 0,
        audio_end_ms: 1234,
      },
    ]);
    expect(value.connection.closeCount).toBe(1);
    await expect(next(events)).resolves.toEqual({ type: "closed", reason: "client_closed" });
  });
});

async function next(
  events: AsyncIterator<import("../../src/modules/conversation/index.js").ConversationRuntimeEvent>,
) {
  const result = await events.next();
  if (result.done) throw new Error("Expected a conversation event");
  return result.value;
}
