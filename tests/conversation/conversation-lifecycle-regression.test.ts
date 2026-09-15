import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIRealtimeAdapter, type ConversationRuntimeEvent, type ConversationRuntimeSession, type RealtimeConnection } from "../../src/modules/conversation/index.js";

class Connection implements RealtimeConnection {
  sent: any[] = [];
  handler?: (event: unknown) => void;
  send(event: unknown) { this.sent.push(event); }
  close() {}
  onEvent(handler: (event: unknown) => void) { this.handler = handler; }
  onError() {}
  onClose() {}
  emit(event: unknown) { this.handler?.(event); }
  requests() { return this.sent.filter(event => event.type === "response.create"); }
}
const sessions: ConversationRuntimeSession[] = [];
async function fixture(mode: "audio" | "text" = "audio") {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  const connection = new Connection();
  const logs: Array<{ message: string; details?: Record<string, unknown> }> = [];
  const adapter = new OpenAIRealtimeAdapter({ apiKey: "test-key", mode,
    connectionFactory: { connect: async () => connection },
    logger: { info: (message, details) => logs.push({ message, details }), error: () => {} },
  });
  const session = await adapter.openSession({ conversationId: "lifecycle", agent: {
    instructions: "Help callers schedule appointments.", locale: "en-US",
    conversation: { model: "gpt-realtime-2.1", maxOutputTokens: 512, reasoningEffort: "minimal", turnDetection: {} },
    tools: ["check_availability", "confirm_appointment", "create_appointment"].map(name => ({
      name: name as "check_availability", description: name, inputSchema: { type: "object" },
    })),
  } });
  sessions.push(session);
  const events: ConversationRuntimeEvent[] = [];
  void (async () => { for await (const event of session.events()) events.push(event); })();
  return { connection, session, events, logs };
}
function start(connection: Connection, id = "caller") {
  connection.emit({ type: "input_audio_buffer.speech_started", item_id: id, event_id: `${id}-start` });
}
function stop(connection: Connection, id = "caller") {
  connection.emit({ type: "input_audio_buffer.speech_stopped", item_id: id, event_id: `${id}-stop` });
}
function commit(connection: Connection, id = "caller") {
  connection.emit({ type: "input_audio_buffer.committed", item_id: id, event_id: `${id}-commit` });
}
function created(connection: Connection, id = "reply") {
  connection.emit({ type: "response.created", response: { id } });
}
function done(connection: Connection, id = "reply", status = "completed") {
  connection.emit({ type: "response.done", response: { id, status } });
}
function audio(connection: Connection, id = "reply") {
  connection.emit({ type: "response.output_audio.delta", response_id: id, item_id: `${id}-audio`, delta: Buffer.alloc(960).toString("base64") });
}

afterEach(async () => { for (const session of sessions.splice(0)) await session.close(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("conversation lifecycle fault injection", () => {
  it("recovers a lost speech-stop event from the matching committed audio item", async () => {
    const { connection } = await fixture();
    start(connection); commit(connection);
    await vi.advanceTimersByTimeAsync(100);
    expect(connection.requests()).toHaveLength(1);
    stop(connection);
    expect(connection.requests()).toHaveLength(1);
  });

  it("recovers lost response-created and tool-arguments events from the final response once", async () => {
    const { connection, session, events } = await fixture();
    start(connection); stop(connection); commit(connection);
    await vi.advanceTimersByTimeAsync(100);
    const output = [{ type: "function_call", call_id: "lookup", name: "check_availability", arguments: "{}" }];
    connection.emit({ type: "response.done", response: { id: "lookup-response", status: "completed", output } });
    connection.emit({ type: "response.done", response: { id: "lookup-response", status: "completed", output } });
    await vi.advanceTimersByTimeAsync(0);
    expect(events.filter(event => event.type === "tool.call")).toHaveLength(1);
    await session.sendToolResult({ toolCallId: "lookup", ok: true, data: {} });
    expect(connection.requests()).toHaveLength(2);
  });

  it("bounds a missing session configuration acknowledgement before the greeting", async () => {
    const { session, events, connection } = await fixture();
    await session.startGreeting?.();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "REALTIME_RESPONSE_TIMEOUT" }));
    expect(connection.requests()).toHaveLength(0);
  });

  it("bounds a lost playback-idle callback without overlapping another response", async () => {
    const { connection, session, events } = await fixture();
    await session.sendText("Wednesday please"); created(connection); audio(connection); done(connection);
    await session.sendText("What time?");
    await vi.advanceTimersByTimeAsync(15_020);
    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "AUDIO_PLAYBACK_TIMEOUT" }));
    expect(connection.requests()).toHaveLength(1);
  });

  it("measures grace, model acknowledgement, tool time, and first audio separately", async () => {
    const { connection, session, events, logs } = await fixture();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    start(connection); await vi.advanceTimersByTimeAsync(500); stop(connection); commit(connection);
    await vi.advanceTimersByTimeAsync(100); // existing local grace
    await vi.advanceTimersByTimeAsync(40); created(connection, "lookup");
    await vi.advanceTimersByTimeAsync(60);
    connection.emit({ type: "response.function_call_arguments.done", response_id: "lookup", call_id: "lookup", name: "check_availability", arguments: "{}" });
    done(connection, "lookup");
    await vi.advanceTimersByTimeAsync(600);
    await session.sendToolResult({ toolCallId: "lookup", ok: true, data: {} });
    await vi.advanceTimersByTimeAsync(40); created(connection, "answer");
    await vi.advanceTimersByTimeAsync(80); audio(connection, "answer");
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toContainEqual(expect.objectContaining({ type: "assistant.response_timing",
      configuredVadSilenceMs: 650, speechEndToCommitMs: 0, commitToDecisionMs: 100,
      toolDurationMs: 600, responseRequestToStartMs: 40, responseStartToFirstAudioMs: 80,
      totalSpeechEndToFirstAudioMs: 920,
    }));
    expect(events.findIndex(event => event.type === "assistant.response_timing"))
      .toBeLessThan(events.findIndex(event => event.type === "audio.delta"));
    expect(logs).toContainEqual(expect.objectContaining({ message: "telephony.turn.delay_classified",
      details: expect.objectContaining({ delayType: "TOOL_WAIT", delayMs: 600 }),
    }));
    done(connection, "answer"); session.assistantPlaybackEnded?.();
  });

  it("retains an early commit until the matching speech stop arrives", async () => {
    const { connection } = await fixture();
    start(connection); commit(connection); stop(connection);
    await vi.advanceTimersByTimeAsync(100);
    expect(connection.requests()).toHaveLength(1);
  });

  it("does not use a delayed commit from an earlier phrase as consent for a correction", async () => {
    const { connection } = await fixture();
    start(connection, "old"); stop(connection, "old");
    start(connection, "correction"); stop(connection, "correction");
    commit(connection, "old");
    await vi.advanceTimersByTimeAsync(100);
    expect(connection.requests()).toHaveLength(0);
    commit(connection, "correction");
    expect(connection.requests()).toHaveLength(1);
  });

  it("accepts the matching user audio item as commit evidence when the commit notification is lost", async () => {
    const { connection } = await fixture();
    start(connection); stop(connection);
    connection.emit({ type: "conversation.item.created", item: { id: "caller", type: "message", role: "user", content: [{ type: "input_audio" }] } });
    await vi.advanceTimersByTimeAsync(100);
    expect(connection.requests()).toHaveLength(1);
    commit(connection);
    expect(connection.requests()).toHaveLength(1);
  });

  it("terminates a missing commit explicitly rather than inventing consent or waiting forever", async () => {
    const { connection, events } = await fixture();
    start(connection); stop(connection);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "REALTIME_COMMIT_TIMEOUT" }));
    expect(connection.requests()).toHaveLength(0);
  });

  it.each(["greeting", "text", "caller", "tool"])("bounds a missing %s response acknowledgement without submitting a duplicate request", async source => {
    const { connection, session, events } = await fixture(source === "text" ? "text" : "audio");
    if (source === "greeting") {
      connection.emit({ type: "session.updated" }); await session.startGreeting?.();
    } else if (source === "text") await session.sendText("Wednesday please");
    else if (source === "caller") { start(connection); stop(connection); commit(connection); await vi.advanceTimersByTimeAsync(100); }
    else {
      connection.emit({ type: "response.function_call_arguments.done", call_id: "availability", name: "check_availability", arguments: "{}" });
      await session.sendToolResult({ toolCallId: "availability", ok: true, data: { slots: [] } });
    }
    await vi.advanceTimersByTimeAsync(15_000);
    expect(connection.requests()).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "REALTIME_RESPONSE_TIMEOUT" }));
  });

  it("bounds a missing response.done even after audio generation started", async () => {
    const { connection, session, events } = await fixture();
    await session.sendText("Wednesday please"); created(connection); audio(connection);
    session.assistantPlaybackEnded?.();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "REALTIME_RESPONSE_TIMEOUT" }));
    expect(connection.requests()).toHaveLength(1);
  });

  it("does not start tool-result speech over audio still playing", async () => {
    const { connection, session } = await fixture();
    created(connection); audio(connection);
    connection.emit({ type: "response.function_call_arguments.done", response_id: "reply", call_id: "availability", name: "check_availability", arguments: "{}" });
    done(connection);
    await session.sendToolResult({ toolCallId: "availability", ok: true, data: {} });
    expect(connection.requests()).toHaveLength(0);
    session.assistantPlaybackEnded?.();
    expect(connection.requests()).toHaveLength(1);
    session.assistantPlaybackEnded?.();
    expect(connection.requests()).toHaveLength(1);
  });

  it("truncates unheard history when the caller interrupts already-generated audio", async () => {
    const { connection, session } = await fixture();
    created(connection); audio(connection); done(connection);
    await session.interrupt({ assistantTurnId: "reply-audio", audioEndMs: 300 });
    expect(connection.sent.filter(event => event.type === "response.cancel")).toHaveLength(0);
    expect(connection.sent.filter(event => event.type === "conversation.item.truncate")).toEqual([
      { type: "conversation.item.truncate", item_id: "reply-audio", content_index: 0, audio_end_ms: 300 },
    ]);
  });

  it("recovers an explicit provider failure once with speech only", async () => {
    const { connection, session, events } = await fixture();
    await session.sendText("What is available?"); created(connection); done(connection, "reply", "failed");
    expect(connection.requests()).toHaveLength(2);
    expect(connection.requests()[1].response.tool_choice).toBe("none");
    created(connection, "recovery"); done(connection, "recovery", "failed");
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "REALTIME_RESPONSE_FAILED" }));
    expect(connection.requests()).toHaveLength(2);
  });
});


describe("multi-turn voice protocol simulations", () => {
  it.each([
    ["immediate answer", 0, 300, 1],
    ["one second thinking pause", 1_000, 300, 1],
    ["several seconds thinking pause", 4_000, 300, 1],
    ["umm followed by answer", 0, 800, 2],
    ["pause mid-sentence", 0, 800, 2],
    ["Tuesday corrected to Wednesday", 0, 1_200, 3],
    ["long uninterrupted answer", 0, 20_000, 1],
    ["one-word answer", 0, 150, 1],
    ["yeah", 0, 150, 1],
    ["that works", 0, 300, 1],
    ["caller changes their mind", 0, 1_200, 2],
    ["caller requests repetition", 0, 800, 1],
    ["long silent wait for caller", 60_000, 300, 1],
    ["multiple short resumed phrases", 0, 800, 4],
  ] as const)("preserves turn boundaries through a whole call: %s", async (_label, thinkingMs, speakingMs, parts) => {
    const { connection, session, logs } = await fixture();
    connection.emit({ type: "session.updated" });
    await session.startGreeting?.();
    created(connection, "greeting"); audio(connection, "greeting"); done(connection, "greeting"); session.assistantPlaybackEnded?.();
    // Greeting -> date -> time -> contact details -> service -> agreement -> closing.
    // Model speech/meaning is a fixture here: this tests turn lifecycle, not ASR quality.
    for (let turn = 0; turn < 6; turn++) {
      const before = connection.requests().length;
      await vi.advanceTimersByTimeAsync(thinkingMs);
      expect(connection.requests()).toHaveLength(before);
      for (let part = 0; part < parts; part++) {
        const id = `caller-${turn}-${part}`;
        start(connection, id);
        await vi.advanceTimersByTimeAsync(speakingMs);
        expect(connection.requests()).toHaveLength(before);
        stop(connection, id); commit(connection, id);
        if (part < parts - 1) await vi.advanceTimersByTimeAsync(80);
      }
      await vi.advanceTimersByTimeAsync(100);
      expect(connection.requests()).toHaveLength(before + 1);
      const response = `answer-${turn}`;
      created(connection, response); audio(connection, response); done(connection, response); session.assistantPlaybackEnded?.();
      expect(logs.filter(log => log.message === "OpenAI Realtime turn state changed").at(-1)?.details?.to).toBe("listening");
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connection.requests()).toHaveLength(7);
  });
});
