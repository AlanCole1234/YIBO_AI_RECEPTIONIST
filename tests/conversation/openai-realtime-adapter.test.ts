import { describe, expect, it } from "vitest";
import {
  OpenAIRealtimeAdapter,
  type RealtimeConnection,
  type RealtimeConnectionFactory,
} from "../../src/modules/conversation/index.js";

const agent = {
  instructions: "Help the caller schedule an appointment.",
  locale: "es-MX",
  conversation: {
    model: "gpt-realtime-2.1", maxOutputTokens: 512, reasoningEffort: "minimal" as const,
    tracing: "disabled" as const, truncation: { mode: "auto" as const },
  },
  audio: {
    voice: "marin", noiseReduction: "near_field" as const,
    turnDetection: {
      type: "server_vad" as const, createResponse: true, interruptResponse: true,
      idleTimeoutMs: 6_000, silenceDurationMs: 800,
    },
  },
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
          "You have authorized access to the clinic calendar only through the provided backend tools. Never claim you cannot access the calendar directly; call check_availability whenever a caller asks about dates or availability. Use the tool result as the sole source of appointment times. Do not ask callers for service IDs or internal names. Use the optional patient-facing service field only for Cleaning or Consultation; omit it to use the clinic default. If a tool result says requestedTimeAvailable is true, clearly say that time is available; if false, say it is unavailable and offer earliestSlot. Never reveal why a time is busy or any other patient's details.",
          "For a new booking, first ask exactly one question: 'What day would you like to come in?' Do not ask for a time of day, service, or personal details first. For supported natural dates, call check_availability with dateExpression; it resolves the actual date in the clinic timezone and checks the real Google Calendar. Offer only earliestSlot first, in one short sentence. After the caller accepts, collect the required contact details when update_customer is available, then use create_appointment and only confirm it after the tool succeeds. When a verified caller asks to reschedule a current appointment, check the requested new time first and use reschedule_appointment only with the known appointment ID and a verified slot. After an idle caller turn, offer one gentle, brief prompt; do not repeatedly prompt when the caller remains silent.",
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
        truncation: "auto",
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
      interrupt_response: true,
      idle_timeout_ms: 6000,
      silence_duration_ms: 800,
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
      connectionFactory: { connect: async () => connection },
    });

    await adapter.openSession({
      conversationId: "conversation-1",
      agent: {
        ...agent,
        audio: {
          ...agent.audio,
          turnDetection: {
            type: "server_vad", createResponse: true, interruptResponse: true,
            idleTimeoutMs: 6000, threshold: 0.5, prefixPaddingMs: 300, silenceDurationMs: 500,
          },
        },
      },
    });

    expect(connection.sent[0]).toMatchObject({
      session: { audio: { input: { turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
        create_response: true,
        interrupt_response: true,
        idle_timeout_ms: 6000,
      } } } },
    });
  });

  it("maps semantic VAD, far-field noise reduction, tracing and retention truncation", async () => {
    const connection = new FakeRealtimeConnection();
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key", mode: "audio", connectionFactory: { connect: async () => connection },
    });

    await adapter.openSession({
      conversationId: "conversation-semantic",
      agent: {
        ...agent,
        conversation: {
          ...agent.conversation,
          tracing: "auto",
          truncation: { mode: "retention_ratio", retentionRatio: 0.8, postInstructionsTokens: 12_000 },
        },
        audio: {
          voice: "cedar",
          noiseReduction: "far_field",
          turnDetection: {
            type: "semantic_vad", eagerness: "low", createResponse: false, interruptResponse: true,
          },
        },
      },
    });

    expect(connection.sent[0]).toMatchObject({ session: {
      audio: { input: {
        noise_reduction: { type: "far_field" },
        turn_detection: {
          type: "semantic_vad", eagerness: "low", create_response: false, interrupt_response: true,
        },
      }, output: { voice: "cedar" } },
      tracing: "auto",
      truncation: {
        type: "retention_ratio", retention_ratio: 0.8, token_limits: { post_instructions: 12_000 },
      },
    } });
  });

  it("maps manual turns and disabled noise reduction to null", async () => {
    const connection = new FakeRealtimeConnection();
    const adapter = new OpenAIRealtimeAdapter({
      apiKey: "test-key", mode: "audio", connectionFactory: { connect: async () => connection },
    });
    await adapter.openSession({
      conversationId: "conversation-manual",
      agent: {
        ...agent,
        audio: { voice: "marin", noiseReduction: "disabled", turnDetection: { type: "manual" } },
      },
    });
    expect(connection.sent[0]).toMatchObject({ session: { audio: { input: {
      noise_reduction: null,
      turn_detection: null,
    } } } });
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

  it("uses server VAD cancellation and truncates local playback exactly once", async () => {
    const value = fixture();
    const session = await open(value);
    const events = session.events()[Symbol.asyncIterator]();

    await session.interrupt({ assistantTurnId: "assistant-1", audioEndMs: 1234.4 });
    await session.interrupt({ assistantTurnId: "assistant-1", audioEndMs: 1400 });
    await session.close();
    await session.close();

    expect(value.connection.sent.filter((event) => (event as { type?: string }).type === "response.cancel")).toEqual([]);
    expect(value.connection.sent.filter((event) => (event as { type?: string }).type === "conversation.item.truncate")).toEqual([{
      type: "conversation.item.truncate",
      item_id: "assistant-1",
      content_index: 0,
      audio_end_ms: 1234,
    }]);
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
