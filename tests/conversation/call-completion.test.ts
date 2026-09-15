import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIRealtimeAdapter, type ConversationRuntimeEvent, type ConversationRuntimeSession, type RealtimeConnection } from "../../src/modules/conversation/index.js";

class Connection implements RealtimeConnection {
  sent: any[] = [];
  handler?: (event: unknown) => void;
  send(event: unknown) { this.sent.push(event); }
  close = vi.fn();
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

describe("explicit call completion", () => {
  it("advertises an explicit end_call action without treating silence as completion", async () => {
    const { connection, events } = await fixture();
    expect(connection.sent[0].session.tools).toContainEqual(expect.objectContaining({name: "end_call"}));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events.some(e => e.type === "closed")).toBe(false);
  });
  it.each(["audio", "text"] as const)("finishes once after the final %s response and actual playback", async mode => {
    const {connection, session, events} = await fixture(mode);
    await session.sendText("No, that is all. Goodbye."); created(connection);
    connection.emit({type: "response.function_call_arguments.done", call_id: "end", name: "end_call", arguments: "{}"});
    done(connection);
    expect(connection.requests()).toHaveLength(2);
    expect(connection.requests()[1].response.tool_choice).toBe("none");
    created(connection, "goodbye");
    if (mode === "audio") audio(connection, "goodbye");
    done(connection, "goodbye");
    if(mode === "audio") { expect(connection.close).not.toHaveBeenCalled(); session.assistantPlaybackEnded?.(); }
    await vi.advanceTimersByTimeAsync(0);
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(events.filter(e=>e.type === "closed")).toHaveLength(1);
    done(connection, "goodbye"); session.assistantPlaybackEnded?.();
    expect(connection.requests()).toHaveLength(2);
    expect(connection.close).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])("finishes confirmation and booking result before goodbye (success=%s)", async ok => {
    const {connection, session, events} = await fixture("text");
    await session.sendText("Yes, book it."); created(connection, "consent");
    connection.emit({type:"response.function_call_arguments.done",call_id:"consent",name:"confirm_appointment",arguments:"{}"});
    done(connection,"consent");
    await session.sendToolResult({toolCallId:"consent",ok:true,data:{confirmationRecorded:true}});
    created(connection,"booking");
    connection.emit({type:"response.function_call_arguments.done",call_id:"book",name:"create_appointment",arguments:"{}"});
    done(connection,"booking");
    await session.sendToolResult(ok ? {toolCallId:"book",ok:true,data:{appointment:{status:"CONFIRMED"},appointmentDisplay:"Tuesday at 10:30 AM"}} : {toolCallId:"book",ok:false,error:{code:"CALENDAR_SYNC_FAILED",message:"Booking failed",retryable:false}});
    created(connection,"result");
    connection.emit({type:"response.output_text.done",response_id:"result",text:ok?"Your appointment is confirmed for Tuesday at 10:30 AM.":"The booking failed."});
    done(connection,"result");
    expect(connection.close).not.toHaveBeenCalled();
    await session.sendText("That is all, goodbye."); created(connection,"ending");
    connection.emit({type:"response.function_call_arguments.done",call_id:"end",name:"end_call",arguments:"{}"});done(connection,"ending");
    created(connection,"goodbye");done(connection,"goodbye");
    await vi.advanceTimersByTimeAsync(0);
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(events.filter(e=>e.type==="tool.call").map(e=>e.name)).toEqual(["confirm_appointment","create_appointment"]);
    expect(connection.requests()).toHaveLength(5);
  });
  it("does not end while a calendar operation is pending", async () => {
    const {connection,session} = await fixture("text");
    await session.sendText("Book it");created(connection);
    connection.emit({type:"response.function_call_arguments.done",call_id:"book",name:"create_appointment",arguments:"{}"});
    connection.emit({type:"response.function_call_arguments.done",call_id:"end",name:"end_call",arguments:"{}"});done(connection);
    expect(connection.close).not.toHaveBeenCalled();
    expect(connection.requests()).toHaveLength(1);
    const output=connection.sent.find(e=>e.item?.call_id==="end");
    expect(JSON.parse(output.item.output).ok).toBe(false);
    await session.sendToolResult({toolCallId:"book",ok:false,error:{code:"CALENDAR_SYNC_FAILED",message:"Failed",retryable:false}});
    expect(connection.requests()).toHaveLength(2);
  });
  it("caller hangup during the final response closes once without another response", async () => {
    const {connection,session} = await fixture();
    await session.sendText("Goodbye");created(connection);
    connection.emit({type:"response.function_call_arguments.done",call_id:"end",name:"end_call",arguments:"{}"});done(connection);
    created(connection,"goodbye");audio(connection,"goodbye");
    await session.close();done(connection,"goodbye");session.assistantPlaybackEnded?.();
    expect(connection.close).toHaveBeenCalledTimes(1);expect(connection.requests()).toHaveLength(2);
  });
  it("lets the caller interrupt the goodbye and continue", async () => {
    const {connection,session} = await fixture();
    await session.sendText("Goodbye");created(connection);
    connection.emit({type:"response.function_call_arguments.done",call_id:"end",name:"end_call",arguments:"{}"});done(connection);
    created(connection,"goodbye");audio(connection,"goodbye");
    await session.interrupt({assistantTurnId:"goodbye-audio",audioEndMs:0});
    done(connection,"goodbye","cancelled");session.assistantPlaybackEnded?.();
    expect(connection.close).not.toHaveBeenCalled();
    await session.sendText("Actually, one more question.");
    expect(connection.requests()).toHaveLength(3);
  });

});
