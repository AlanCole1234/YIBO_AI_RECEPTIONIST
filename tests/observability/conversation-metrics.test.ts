import { describe, expect, it, vi } from "vitest";
import { ConversationMetrics } from "../../src/shared/observability/conversation-metrics.js";
import { operationalLog, operationalRecord, withOperationalContext } from "../../src/shared/observability/operational-log.js";
const context = { tenantId: "tenant-test", locationId: "north", callId: "call-test" };
function fixture() {
  let now = 0; const records: Array<Record<string, unknown>> = [];
  const metrics = new ConversationMetrics(context, (event, fields, trusted) => records.push(operationalRecord(event, fields, trusted)), () => now);
  return { metrics, records, at: (value: number) => { now = value; } };
}
const audio = (id = "turn-1") => ({ type: "audio.delta" as const, assistantTurnId: id, frame: { codec: "pcm_s16le", sampleRate: 24000, channels: 1, data: new Uint8Array([123]) } });

describe("OBS-001 privacy and correlation", () => {
  it("drops content, credentials, scheduling details and unrecognized fields", () => {
    const record = operationalRecord("calendar.failure", { phone: "+12025550199", name: "Patient Example", calendarId: "patient@example.com", startAt: "2026-12-01", transcript: "private words", arguments: { secret: "token" }, error: "provider credentials", code: "private words", bytes: 20, packetCount: 4, p95ElapsedMs: 21.5 }, context);
    expect(record).toMatchObject({ bytes: 20, packetCount: 4, p95ElapsedMs: 21.5, code: "OTHER" });
    const serialized = JSON.stringify(record);
    for (const secret of ["Patient Example", "patient@example.com", "2026-12-01", "private words", "credentials", "tenant-test", "north", "call-test"]) expect(serialized).not.toContain(secret);
  });
  it("uses stable correlation tokens and separates tenants/locations/calls", () => {
    const first = operationalRecord("call.started", {}, context);
    expect(operationalRecord("call.ended", {}, context).call).toBe(first.call);
    expect(operationalRecord("call.started", {}, { ...context, tenantId: "other" }).location).not.toBe(first.location);
    expect(operationalRecord("call.started", {}, { ...context, callId: "other" }).call).not.toBe(first.call);
  });
  it("propagates trusted context across asynchronous tools without cross-call mixing", async () => {
    const result = await Promise.all(["one", "two"].map(callId => withOperationalContext({ ...context, callId }, async () => {
      await new Promise(resolve => setImmediate(resolve));
      return operationalRecord("calendar.failure", { callId: "untrusted", tenantId: "untrusted" });
    })));
    expect(result[0]!.call).not.toBe(result[1]!.call);
    expect(result[0]!.tenant).toBe(result[1]!.tenant);
  });
  it("does not let a broken default log sink throw into business code", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => { throw new Error("log failure"); });
    try { expect(() => operationalLog("call.started", {}, context)).not.toThrow(); } finally { spy.mockRestore(); }
  });
});

describe("OBS-001 bounded call timings", () => {
  it("records VAD, response creation, first audio, actual RTP and final response turn latency once", () => {
    const { metrics, records, at } = fixture();
    metrics.observe({ type: "user.speech_stopped" });
    at(100); metrics.observe({ type: "assistant.response_created" });
    at(150); metrics.observe(audio());
    at(300); metrics.mediaSent("turn-1"); metrics.mediaSent("turn-1"); metrics.observe(audio());
    at(600); metrics.observe({ type: "assistant.response_done" });
    at(700); metrics.observe({ type: "assistant.response_done" });
    at(900); metrics.close(); metrics.close();
    const samples = records.filter(r => r.event === "conversation.latency");
    expect(samples.filter(r => r.metric === "speech_to_first_audio")).toHaveLength(1);
    expect(samples.filter(r => r.metric === "first_audio_to_rtp")).toEqual([expect.objectContaining({ durationMs: 150 })]);
    expect(samples).toContainEqual(expect.objectContaining({ metric: "turn_duration", durationMs: 700 }));
    expect(samples.filter(r => r.metric === "session_duration")).toHaveLength(1);
  });
  it("does not invent speech latency for greetings or RTP latency without real packets", () => {
    const { metrics, records } = fixture();
    metrics.observe(audio()); metrics.observe({ type: "assistant.response_done" }); metrics.close();
    expect(records.some(r => r.metric === "speech_to_first_audio" || r.metric === "first_audio_to_rtp")).toBe(false);
  });
  it("records tools, confirmation gates, calendar failures and transfer outcomes without results", () => {
    const { metrics, records, at } = fixture();
    metrics.observe({ type: "tool.execution", phase: "started", toolCallId: "secret-id", name: "create_appointment" });
    at(20); metrics.observe({ type: "tool.execution", phase: "failed", toolCallId: "secret-id", name: "create_appointment", outcomeCode: "CONFIRMATION_REQUIRED" });
    metrics.observe({ type: "tool.execution", phase: "failed", toolCallId: "next", name: "create_appointment", outcomeCode: "CALENDAR_SYNC_FAILED" });
    metrics.observe({ type: "tool.execution", phase: "completed", toolCallId: "transfer", name: "transfer_to_human" });
    expect(records).toContainEqual(expect.objectContaining({ metric: "tool_round_trip", durationMs: 20 }));
    for (const event of ["conversation.confirmation", "conversation.calendar_failure", "conversation.transfer"]) expect(records.some(r => r.event === event)).toBe(true);
    expect(JSON.stringify(records)).not.toContain("secret-id");
  });
  it("summarizes only the bounded last 256 samples with nearest-rank percentiles", () => {
    const { metrics, records } = fixture();
    for (let i = 1; i <= 300; i++) metrics.timing("tool_round_trip", i);
    metrics.close();
    expect(records).toContainEqual(expect.objectContaining({ event: "conversation.latency_summary", metric: "tool_round_trip", sampleCount: 256, p50Ms: 172, p95Ms: 288 }));
    const count = records.length; metrics.timing("tool_round_trip", 20); metrics.observe(audio());
    expect(records).toHaveLength(count);
  });
  it("ignores invalid durations and observer failures", () => {
    const metrics = new ConversationMetrics(context, () => { throw new Error("sink failure"); });
    expect(() => { metrics.timing("cleanup", NaN); metrics.timing("cleanup", -1); metrics.observe(audio()); metrics.close(); }).not.toThrow();
  });
});
