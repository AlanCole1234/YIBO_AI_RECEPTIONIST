import type { ConversationRuntimeEvent } from "../../modules/conversation/ports/conversation-runtime-port.js";
import { operationalLog, type OperationalContext } from "./operational-log.js";

type Metric = "speech_to_response" | "speech_to_first_audio" | "speech_to_response_done" | "first_audio_to_rtp" | "tool_round_trip" | "session_startup" | "session_duration" | "turn_duration" | "cleanup";
export class ConversationMetrics {
  private readonly started: number;
  private speechEnd?: number;
  private responseEnd?: number;
  private measured = new Set<Metric>();
  private tools = new Map<string, number>();
  private audioTurns = new Map<string, { started: number; sent: boolean }>();
  private samples = new Map<Metric, number[]>();
  private closed = false;
  constructor(private readonly context: OperationalContext,
    private readonly sink = operationalLog,
    private readonly now = () => performance.now()) { this.started = now(); }
  private emit(event: string, fields: Record<string, unknown> = {}) {
    try { this.sink(event, fields, this.context); } catch { /* No observer failure reaches the call. */ }
  }
  timing(metric: Metric, durationMs: number) {
    if (this.closed || !Number.isFinite(durationMs) || durationMs < 0) return;
    const samples = this.samples.get(metric) ?? [];
    if (samples.length === 256) samples.shift();
    samples.push(durationMs); this.samples.set(metric, samples);
    this.emit("conversation.latency", { metric, durationMs });
  }
  observe(event: ConversationRuntimeEvent) {
    if (this.closed) return;
    if (event.type === "user.speech_started") {
      this.finishTurn(); this.speechEnd = undefined; this.measured.clear();
      this.emit("conversation.vad", { phase: "speech_started" });
    } else if (event.type === "user.speech_stopped") {
      this.finishTurn(); this.speechEnd = this.now(); this.measured.clear();
      this.emit("conversation.vad", { phase: "speech_stopped" });
    } else if (event.type === "silence.timeout") this.emit("conversation.vad", { phase: "silence_timeout" });
    else if (event.type === "assistant.response_created") { this.emit("conversation.response", { phase: "started" }); this.turnTiming("speech_to_response"); }
    else if (event.type === "audio.delta") {
      this.turnTiming("speech_to_first_audio");
      if (!this.audioTurns.has(event.assistantTurnId)) {
        if (this.audioTurns.size === 32) this.audioTurns.delete(this.audioTurns.keys().next().value!);
        this.audioTurns.set(event.assistantTurnId, { started: this.now(), sent: false });
      }
    }
    else if (event.type === "assistant.response_done") { this.emit("conversation.response", { phase: event.status ?? "unknown" }); this.responseEnd = this.now(); this.turnTiming("speech_to_response_done"); }
    else if (event.type === "error") this.emit("conversation.error", { code: event.code });
    else if (event.type === "tool.execution") {
      if (event.phase === "started") {
        if (this.tools.size < 100 && !this.tools.has(event.toolCallId)) this.tools.set(event.toolCallId, this.now());
      } else {
        const start = this.tools.get(event.toolCallId);
        if (start !== undefined) this.timing("tool_round_trip", this.now() - start);
        this.tools.delete(event.toolCallId);
      }
      this.emit("conversation.tool", { tool: event.name, phase: event.phase, ...(event.outcomeCode ? { code: event.outcomeCode } : {}) });
      if (event.outcomeCode?.includes("CONFIRMATION")) this.emit("conversation.confirmation", { code: event.outcomeCode });
      if (event.outcomeCode === "CALENDAR_SYNC_FAILED" || event.outcomeCode === "EXTERNAL_CALENDAR_UNAVAILABLE") this.emit("conversation.calendar_failure", { code: event.outcomeCode });
      if (event.name === "transfer_to_human") this.emit("conversation.transfer", { phase: event.phase });
    }
  }
  private finishTurn() {
    if (this.speechEnd !== undefined && this.responseEnd !== undefined) this.timing("turn_duration", this.responseEnd - this.speechEnd);
    this.responseEnd = undefined;
  }
  mediaSent(turnId: string) {
    const audio = this.audioTurns.get(turnId);
    if (!audio || audio.sent || this.closed) return;
    audio.sent = true; this.timing("first_audio_to_rtp", this.now() - audio.started);
  }
  private turnTiming(metric: Metric) {
    if (this.speechEnd === undefined || this.measured.has(metric)) return;
    this.measured.add(metric); this.timing(metric, this.now() - this.speechEnd);
  }
  close() {
    if (this.closed) return;
    this.finishTurn();
    this.timing("session_duration", this.now() - this.started);
    this.closed = true;
    for (const [metric, samples] of this.samples) {
      const sorted = [...samples].sort((a, b) => a - b);
      this.emit("conversation.latency_summary", { metric, sampleCount: sorted.length,
        p50Ms: sorted[Math.ceil(sorted.length * .5) - 1], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] });
    }
    this.tools.clear(); this.samples.clear(); this.measured.clear(); this.audioTurns.clear();
  }
}
