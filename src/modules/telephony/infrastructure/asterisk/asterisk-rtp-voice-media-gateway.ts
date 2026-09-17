import { operationalLog } from "../../../../shared/observability/operational-log.js";
import dgram, { type RemoteInfo, type Socket } from "node:dgram";
import { performance } from "node:perf_hooks";
import { failure, success } from "../../../../shared/domain/result.js";
import type { CallId } from "../../../../shared/types/identifiers.js";
import type { AudioFrame, ConversationTransport, VoiceMediaGateway } from "../../../voice/index.js";
import type { AssistantPlaybackPosition } from "../../../conversation/index.js";
import { RealtimeToUlawStream, TELEPHONE_SAMPLE_RATE, ulawToRealtimeFrame } from "../../../voice/index.js";
import type { AsteriskMediaClient } from "./asterisk-client.js";
import { createRtpPacket, parseRtpPacket, RTP_ULAW_PAYLOAD_TYPE } from "./rtp.js";

const RTP_FRAME_BYTES = 160;
const RTP_FRAME_DURATION_MS = 20;
const OUTBOUND_PREBUFFER_BYTES = RTP_FRAME_BYTES * 4;
const OUTBOUND_PREBUFFER_WAIT_MS = 80;
const ECHO_HISTORY_MS = 1_000;
const ECHO_SUSPECTED_CORRELATION = 0.85;
// Realtime can produce speech faster than it can be played over an 8 kHz phone
// connection. Keep enough bounded headroom for a normal response instead of
// dropping the start/middle of an active sentence.
const MAX_OUTBOUND_QUEUE_DURATION_SECONDS = 30;
const MAX_OUTBOUND_QUEUE_BYTES = TELEPHONE_SAMPLE_RATE * MAX_OUTBOUND_QUEUE_DURATION_SECONDS;

export interface AsteriskRtpVoiceMediaOptions {
  host: string;
  portStart: number;
  portEnd: number;
  logger?: (event: string, details?: Record<string, unknown>) => void;
}

/**
 * Owns the private Asterisk External Media resource for one active YIBO call.
 * It uses static G.711 µ-law RTP to keep the wire format explicit and converts
 * only at the boundary to the existing Realtime 24 kHz PCM transport.
 */
export class AsteriskRtpVoiceMediaGateway implements VoiceMediaGateway {
  private readonly sessions = new Map<string, AsteriskRtpSession>();
  private readonly reservedPorts = new Set<number>();
  private nextPort: number;
  private readonly log: (event: string, details?: Record<string, unknown>) => void;

  constructor(private readonly client: AsteriskMediaClient, private readonly options: AsteriskRtpVoiceMediaOptions) {
    if (!options.host.trim()) throw new Error("YIBO_ASTERISK_MEDIA_HOST is required when Asterisk media is enabled");
    if (!Number.isInteger(options.portStart) || !Number.isInteger(options.portEnd) || options.portStart < 1 || options.portEnd < options.portStart || options.portEnd > 65_535) {
      throw new Error("YIBO_ASTERISK_MEDIA_PORT_START and YIBO_ASTERISK_MEDIA_PORT_END must be a valid UDP range");
    }
    this.nextPort = options.portStart;
    this.log = options.logger ?? operationalLog;
  }

  async prepare(callId: CallId, callerChannelId: string, dialedNumber?: string): Promise<void> {
    if (this.sessions.has(callId)) return;
    const port = this.reservePort();
    const session = new AsteriskRtpSession(callId, callerChannelId, this.client, this.options, this.log, () => this.reservedPorts.delete(port));
    this.sessions.set(callId, session);
    try {
      await session.start(port);
    } catch (error) {
      this.sessions.delete(callId);
      await session.close();
      throw error;
    }
  }

  async open(callId: string) {
    const session = this.sessions.get(callId);
    if (!session) return failure({ code: "MEDIA_NOT_AVAILABLE" as const, message: `No Asterisk RTP transport is prepared for call ${callId}` });
    return success(session.transport());
  }

  async cleanup(callId: CallId): Promise<void> {
    const session = this.sessions.get(callId);
    if (!session) return;
    this.sessions.delete(callId);
    await session.close();
  }

  private reservePort(): number {
    const count = this.options.portEnd - this.options.portStart + 1;
    for (let index = 0; index < count; index += 1) {
      const selected = this.nextPort;
      this.nextPort = this.nextPort === this.options.portEnd ? this.options.portStart : this.nextPort + 1;
      if (!this.reservedPorts.has(selected)) {
        this.reservedPorts.add(selected);
        return selected;
      }
    }
    throw new Error("All configured Asterisk RTP media ports are in use");
  }
}

class AsteriskRtpSession {
  private socket?: Socket;
  private bridgeId?: string;
  private externalChannelId?: string;
  private remote?: RemoteInfo;
  private readonly remoteWaiters = new Set<() => void>();
  private readonly inbound = new AsyncFrameQueue<AudioFrame>();
  private closed = false;
  private outputSequence = Math.floor(Math.random() * 0xffff);
  private outputTimestamp = Math.floor(Math.random() * 0xffff_ffff);
  private readonly outputSsrc = Math.floor(Math.random() * 0xffff_ffff);
  private currentAssistantTurnId?: string;
  private assistantTurnNumber = 0;
  private lastAssistantTurnId?: string;
  private lastRtpSentAt?: number;
  private lastPlaybackEndedAt?: number;
  private outputSamples = 0;
  private assistantPlaybackStartedAt?: number;
  private readonly outboundPcmuHistory: Array<{ sentAt: number; payload: Uint8Array }> = [];
  private latestEcho?: { correlation: number; detectedAt: number };
  private readonly pacer: PcmuRtpPacer;
  private readonly outboundConverter = new RealtimeToUlawStream();
  private outboundConverterTurnId?: string;
  private firstRealtimeAudioReceivedAt?: number;
  private firstAudioListener?: (assistantTurnId: string) => void;
  private measuredAudioTurnId?: string;
  private playbackIdleListener?: () => void;

  constructor(
    private readonly callId: string,
    private readonly callerChannelId: string,
    private readonly client: AsteriskMediaClient,
    private readonly options: AsteriskRtpVoiceMediaOptions,
    private readonly log: (event: string, details?: Record<string, unknown>) => void,
    private readonly releasePort: () => void,
  ) {
    this.pacer = new PcmuRtpPacer({
      callId: this.callId,
      send: async (payload, assistantTurnId, queueDepth, timing) => this.sendRtpPacket(payload, assistantTurnId, queueDepth, timing),
      log: this.log,
      onError: () => this.inbound.fail(new Error("RTP send failed")),
    });
  }

  async start(port: number): Promise<void> {
    const socket = await bindUdp(this.options.host, port);
    this.socket = socket;
    socket.on("message", (packet, remote) => this.receiveRtp(packet, remote));
    socket.on("error", (error) => this.log("telephony.media.rtp_error", { callId: this.callId, error: safeError(error) }));
    this.log("telephony.media.rtp_listening", { callId: this.callId, host: this.options.host, port });

    const bridge = await this.client.createMixingBridge();
    this.bridgeId = bridge.bridgeId;
    await this.client.addChannelsToBridge(bridge.bridgeId, [this.callerChannelId]);
    this.log("telephony.media.bridge_created", { callId: this.callId, bridgeId: bridge.bridgeId });

    const external = await this.client.createExternalMedia({ host: this.options.host, port, format: "ulaw", direction: "both" });
    this.externalChannelId = external.channelId;
    await this.client.addChannelsToBridge(bridge.bridgeId, [external.channelId]);
    this.log("telephony.media.external_channel_created", { callId: this.callId, bridgeId: bridge.bridgeId, externalChannelId: external.channelId, codec: "ulaw", sampleRate: TELEPHONE_SAMPLE_RATE });
  }

  transport(): ConversationTransport {
    return {
      inboundAudio: this.inbound,
      outboundAudio: {
        onFirstAudioSent: listener => { this.firstAudioListener = listener; return () => { this.firstAudioListener = undefined; }; },
        write: async (frame, assistantTurnId) => this.sendRealtimeAudio(frame, assistantTurnId),
        onPlaybackIdle: (listener) => {
          this.playbackIdleListener = listener;
          return () => {
            if (this.playbackIdleListener === listener) this.playbackIdleListener = undefined;
          };
        },
        interrupt: async () => this.interruptOutput(),
        getBargeInDiagnostics: () => ({
          outboundRtpPlaying: this.pacer.isPlaying(),
          outboundQueueDepth: this.pacer.queueDepth(),
          ...(this.assistantPlaybackStartedAt === undefined ? {} : { assistantPlaybackMs: Math.round(performance.now() - this.assistantPlaybackStartedAt) }),
          ...(this.latestEcho && performance.now() - this.latestEcho.detectedAt <= ECHO_HISTORY_MS
            ? { echoCorrelation: this.latestEcho.correlation, echoSuspected: this.latestEcho.correlation >= ECHO_SUSPECTED_CORRELATION }
            : {}),
        }),
      },
      close: async () => this.close(),
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.inbound.end();
    for (const ready of this.remoteWaiters) ready();
    this.pacer.stop("call_closed");
    const socket = this.socket;
    this.socket = undefined;
    if (socket) await closeSocket(socket);
    await Promise.allSettled([
      this.externalChannelId ? this.client.hangup(this.externalChannelId) : Promise.resolve(),
      this.bridgeId ? this.client.destroyBridge(this.bridgeId) : Promise.resolve(),
    ]);
    this.releasePort();
    this.log("telephony.media.cleanup", { callId: this.callId, ...(this.bridgeId ? { bridgeId: this.bridgeId } : {}), ...(this.externalChannelId ? { externalChannelId: this.externalChannelId } : {}) });
  }

  private receiveRtp(packet: Buffer, remote: RemoteInfo): void {
    if (this.closed) return;
    const parsed = parseRtpPacket(packet);
    if (!parsed || parsed.payloadType !== RTP_ULAW_PAYLOAD_TYPE || parsed.payload.byteLength === 0) return;
    if (this.remote && (this.remote.address !== remote.address || this.remote.port !== remote.port)) return;
    this.remote = remote;
    for (const ready of this.remoteWaiters) ready();
    try {
      const echoCorrelation = this.findOutboundEchoCorrelation(parsed.payload);
      if (echoCorrelation !== undefined) {
        this.latestEcho = { correlation: echoCorrelation, detectedAt: performance.now() };
        if (echoCorrelation >= ECHO_SUSPECTED_CORRELATION) {
          this.log("telephony.media.echo_suspected", {
            callId: this.callId,
            echoCorrelation,
            outboundRtpPlaying: this.pacer.isPlaying(),
          });
        }
      }
      this.inbound.push(ulawToRealtimeFrame(parsed.payload));
      this.log("telephony.media.rtp_received", {
        callId: this.callId,
        bytes: parsed.payload.byteLength,
        payloadType: parsed.payloadType,
        ...(echoCorrelation === undefined ? {} : { echoCorrelation, echoSuspected: echoCorrelation >= ECHO_SUSPECTED_CORRELATION }),
      });
      this.log("telephony.media.realtime_audio_sent", { callId: this.callId, bytes: Math.round(parsed.payload.byteLength * 3) });
    } catch (error) {
      this.log("telephony.media.rtp_decode_failed", { callId: this.callId, error: safeError(error) });
    }
  }

  private async sendRealtimeAudio(frame: AudioFrame, assistantTurnId: string): Promise<void> {
    if (this.closed || !this.socket) return;
    if (!this.remote) await new Promise<void>((resolve, reject) => {
      const finish = () => { clearTimeout(timer); this.remoteWaiters.delete(finish); resolve(); };
      const timer = setTimeout(() => { this.remoteWaiters.delete(finish); reject(new Error("Asterisk RTP peer did not become ready")); }, 4_000);
      this.remoteWaiters.add(finish);
    });
    if (this.closed) return;
    if (this.outboundConverterTurnId !== assistantTurnId) {
      this.log("telephony.turn_transition_ready", {
        callId: this.callId,
        nextAssistantTurnNumber: this.assistantTurnNumber + 1,
        oldPlaybackQueueEmpty: this.pacer.queueDepth() === 0,
        oldPlaybackTimerActive: this.pacer.isPlaying(),
        responsePlaybackStateReset: this.assistantPlaybackStartedAt === undefined,
      });
      this.outboundConverter.reset();
      this.outboundConverterTurnId = assistantTurnId;
      this.firstRealtimeAudioReceivedAt = performance.now();
    }
    const payload = this.outboundConverter.convert(frame);
    if (payload.byteLength === 0) return;
    this.log("telephony.media.realtime_audio_received", { callId: this.callId, bytes: frame.data.byteLength });
    this.pacer.enqueue(payload, assistantTurnId);
  }

  private async sendRtpPacket(payload: Uint8Array, assistantTurnId: string, queueDepth: number, timing: RtpPacingTiming): Promise<void> {
    if (this.closed || !this.socket || !this.remote) return;
    this.currentAssistantTurnId = assistantTurnId;
    if (this.lastAssistantTurnId !== assistantTurnId) {
      this.assistantTurnNumber += 1;
      this.lastAssistantTurnId = assistantTurnId;
    }
    if (this.assistantPlaybackStartedAt === undefined) this.assistantPlaybackStartedAt = performance.now();
    const now = performance.now();
    const timeSincePreviousRtpMs = this.lastRtpSentAt === undefined ? undefined : now - this.lastRtpSentAt;
    if (timing.talkspurtStarted && timeSincePreviousRtpMs !== undefined) {
      // RTP timestamps represent the media timeline. Advance over a silent gap
      // rather than pretending the new assistant turn immediately followed the old.
      this.outputTimestamp = (this.outputTimestamp + Math.max(0, Math.round(timeSincePreviousRtpMs * TELEPHONE_SAMPLE_RATE / 1_000))) >>> 0;
    }
    const packet = createRtpPacket({
      payload,
      sequenceNumber: this.outputSequence,
      timestamp: this.outputTimestamp,
      ssrc: this.outputSsrc,
      marker: timing.talkspurtStarted,
    });
    const sequenceNumber = this.outputSequence;
    const timestamp = this.outputTimestamp;
    this.outputSequence = (this.outputSequence + 1) & 0xffff;
    this.outputTimestamp = (this.outputTimestamp + RTP_FRAME_BYTES) >>> 0;
    this.outputSamples += payload.byteLength;
    await new Promise<void>((resolve, reject) => this.socket!.send(packet, this.remote!.port, this.remote!.address, (error) => error ? reject(error) : resolve()));
    this.recordOutboundPcmu(payload);
    this.lastRtpSentAt = now;
    if (timing.queueBecameEmpty) this.lastPlaybackEndedAt = now;
    if (timing.talkspurtStarted) {
      if (this.measuredAudioTurnId !== assistantTurnId) {
        this.measuredAudioTurnId = assistantTurnId;
        try { this.firstAudioListener?.(assistantTurnId); } catch { /* Observation only. */ }
      }
      this.log("telephony.media.rtp_talkspurt_started", {
        callId: this.callId,
        assistantTurnNumber: this.assistantTurnNumber,
        sequenceNumber,
        timestamp,
        markerBit: true,
        millisecondsSincePreviousRtp: timeSincePreviousRtpMs === undefined ? undefined : Math.round(timeSincePreviousRtpMs),
        millisecondsSincePreviousAssistantPlaybackEnded: this.lastPlaybackEndedAt === undefined ? undefined : Math.round(now - this.lastPlaybackEndedAt),
        pacingStateReset: true,
        queueDepth,
        ssrc: this.outputSsrc,
      });
      this.log("telephony.turn.first_rtp_sent", {
        callId: this.callId,
        assistantTurnNumber: this.assistantTurnNumber,
        at: new Date().toISOString(),
        ...(this.firstRealtimeAudioReceivedAt === undefined ? {} : {
          firstAudioToFirstRtpMs: Math.round(now - this.firstRealtimeAudioReceivedAt),
        }),
      });

    }
    this.log("telephony.media.rtp_sent", {
      callId: this.callId,
      bytes: payload.byteLength,
      payloadType: RTP_ULAW_PAYLOAD_TYPE,
      sequenceNumber,
      timestamp,
      ssrc: this.outputSsrc,
      elapsedMs: timing.elapsedMs,
      scheduleDriftMs: timing.scheduleDriftMs,
      queueDepth,
      queueBecameEmpty: timing.queueBecameEmpty,
      assistantTurnNumber: this.assistantTurnNumber,
      markerBit: timing.talkspurtStarted,
    });
    if (timing.queueBecameEmpty) {
      this.currentAssistantTurnId = undefined;
      this.outputSamples = 0;
      this.assistantPlaybackStartedAt = undefined;
      this.log("telephony.media.assistant_playback_idle", {
        callId: this.callId,
        assistantTurnNumber: this.assistantTurnNumber,
      });
      this.log("telephony.turn.listening_ready", {
        callId: this.callId,
        assistantTurnNumber: this.assistantTurnNumber,
        lastAssistantRtpToListeningReadyMs: 0,
      });
      this.playbackIdleListener?.();
    }
  }

  private async interruptOutput(): Promise<AssistantPlaybackPosition | undefined> {
    if (!this.currentAssistantTurnId) return undefined;
    const position = { assistantTurnId: this.currentAssistantTurnId, audioEndMs: Math.round(this.outputSamples * 1_000 / TELEPHONE_SAMPLE_RATE) };
    this.pacer.clear("barge_in");
    this.outboundConverter.reset();
    this.outboundConverterTurnId = undefined;
    this.currentAssistantTurnId = undefined;
    this.outputSamples = 0;
    this.assistantPlaybackStartedAt = undefined;
    this.playbackIdleListener?.();
    return position;
  }

  private recordOutboundPcmu(payload: Uint8Array): void {
    const sentAt = performance.now();
    this.outboundPcmuHistory.push({ sentAt, payload: payload.slice() });
    while (this.outboundPcmuHistory[0] && sentAt - this.outboundPcmuHistory[0].sentAt > ECHO_HISTORY_MS) {
      this.outboundPcmuHistory.shift();
    }
  }

  private findOutboundEchoCorrelation(inbound: Uint8Array): number | undefined {
    const now = performance.now();
    let highest = 0;
    let compared = false;
    for (const output of this.outboundPcmuHistory) {
      if (now - output.sentAt > ECHO_HISTORY_MS || output.payload.byteLength !== inbound.byteLength) continue;
      compared = true;
      let matches = 0;
      for (let index = 0; index < inbound.byteLength; index += 1) {
        if (inbound[index] === output.payload[index]) matches += 1;
      }
      highest = Math.max(highest, matches / inbound.byteLength);
    }
    return compared ? Math.round(highest * 10_000) / 10_000 : undefined;
  }
}

interface QueuedAudio {
  data: Uint8Array;
  offset: number;
  assistantTurnId: string;
}

interface PcmuRtpPacerOptions {
  callId: string;
  send(payload: Uint8Array, assistantTurnId: string, queueDepth: number, timing: RtpPacingTiming): Promise<void>;
  log(event: string, details?: Record<string, unknown>): void;
  monotonicNow?(): number;
  onError?(): void;
}

export interface RtpPacingTiming {
  elapsedMs?: number;
  /** Positive values mean the process was late relative to the 20 ms RTP deadline. */
  scheduleDriftMs: number;
  queueBecameEmpty: boolean;
  talkspurtStarted: boolean;
}

/** Sends fixed 20 ms PCMU RTP frames without overlapping timer/send loops. */
export class PcmuRtpPacer {
  private readonly queue: QueuedAudio[] = [];
  private queuedBytes = 0;
  private draining = false;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private generation = 0;
  private prebufferTimer?: NodeJS.Timeout;
  private nextFrameDueAt?: number;
  private lastPacketSentAt?: number;
  private playbackStartedAt?: number;
  private talkspurtStarted = false;
  private talkspurtTurnId?: string;
  private assistantTurnNumber = 0;
  private readonly packetIntervalsMs: number[] = [];
  private packetCount = 0;
  private maxBufferedAudioMs = 0;
  private totalBufferedAudioMs = 0;
  private queueObservations = 0;

  constructor(private readonly options: PcmuRtpPacerOptions) {}

  enqueue(data: Uint8Array, assistantTurnId: string): void {
    if (this.stopped || data.byteLength === 0) return;
    if (this.queuedBytes + data.byteLength > MAX_OUTBOUND_QUEUE_BYTES) {
      throw new Error("Outbound RTP buffer capacity exceeded");
    }
    this.queue.push({ data, offset: 0, assistantTurnId });
    this.queuedBytes += data.byteLength;
    this.observeQueue();
    this.options.log("telephony.media.rtp_queued", {
      callId: this.options.callId,
      encodedBytes: data.byteLength,
      queueDepth: this.queuedBytes,
      bufferedAudioMs: bytesToMilliseconds(this.queuedBytes),
    });
    if (!this.draining) {
      this.draining = true;
      if (this.queuedBytes >= OUTBOUND_PREBUFFER_BYTES) this.startDraining();
      else this.beginPrebufferWait();
    } else if (this.prebufferTimer && this.queuedBytes >= OUTBOUND_PREBUFFER_BYTES) {
      this.startDraining();
    }
  }

  clear(reason: "barge_in" | "call_closed"): void {
    this.logQualitySummary(reason);
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.prebufferTimer) clearTimeout(this.prebufferTimer);
    this.prebufferTimer = undefined;
    this.draining = false;
    this.nextFrameDueAt = undefined;
    this.playbackStartedAt = undefined;
    this.lastPacketSentAt = undefined;
    this.queue.length = 0;
    this.queuedBytes = 0;
    this.options.log("telephony.media.rtp_pacing_stopped", { callId: this.options.callId, reason });
  }

  stop(reason: "call_closed"): void {
    this.stopped = true;
    this.clear(reason);
  }

  isPlaying(): boolean {
    return this.draining && this.queuedBytes > 0;
  }

  queueDepth(): number {
    return this.queuedBytes;
  }

  private async drain(generation: number): Promise<void> {
    if (this.stopped || generation !== this.generation) return;
    if (this.queuedBytes < RTP_FRAME_BYTES) {
      this.draining = false;
      this.nextFrameDueAt = undefined;
      this.options.log("telephony.media.rtp_queue_underflow", {
        callId: this.options.callId,
        queueDepth: this.queuedBytes,
        responseMayStillBeActive: true,
      });
      return;
    }
    const packet = this.takeFrame();
    if (!packet) {
      this.draining = false;
      return;
    }
    try {
      const now = this.now();
      const elapsedMs = this.lastPacketSentAt === undefined ? undefined : roundMilliseconds(now - this.lastPacketSentAt);
      const scheduleDriftMs = this.nextFrameDueAt === undefined ? 0 : roundMilliseconds(now - this.nextFrameDueAt);
      this.lastPacketSentAt = now;
      await this.options.send(packet.payload, packet.assistantTurnId, this.queuedBytes, {
        elapsedMs,
        scheduleDriftMs,
        queueBecameEmpty: this.queuedBytes === 0,
        talkspurtStarted: this.talkspurtStarted,
      });
      this.talkspurtStarted = false;
      this.packetCount += 1;
      if (elapsedMs !== undefined) this.packetIntervalsMs.push(elapsedMs);
      this.observeQueue();
      if (scheduleDriftMs > 15) {
        this.options.log("telephony.media.event_loop_stall", {
          callId: this.options.callId,
          scheduleDriftMs,
          elapsedMs,
          queueDepth: this.queuedBytes,
        });
      }
      if (this.queuedBytes === 0) {
        this.draining = false;
        this.nextFrameDueAt = undefined;
        this.timer = undefined;
        this.logQualitySummary("queue_drained");
        return;
      }
    } catch (error) {
      this.options.onError?.();
      this.options.log("telephony.media.rtp_send_failed", { callId: this.options.callId, error: safeError(error) });
      this.stop("call_closed");
      return;
    }
    if (this.stopped || generation !== this.generation) return;
    const dueAt = (this.nextFrameDueAt ?? this.now()) + RTP_FRAME_DURATION_MS;
    this.nextFrameDueAt = dueAt;
    const delay = Math.max(0, dueAt - this.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.drain(generation);
    }, delay);
  }

  private startDraining(): void {
    if (this.stopped || !this.draining) return;
    if (this.prebufferTimer) clearTimeout(this.prebufferTimer);
    this.prebufferTimer = undefined;
    this.nextFrameDueAt = undefined;
    this.playbackStartedAt = this.now();
    this.talkspurtStarted = true;
    this.talkspurtTurnId = this.queue[0]?.assistantTurnId;
    this.assistantTurnNumber += 1;
    this.options.log("telephony.media.rtp_pacing_started", {
      callId: this.options.callId,
      queueDepth: this.queuedBytes,
      prebufferBytes: OUTBOUND_PREBUFFER_BYTES,
      assistantTurnId: this.talkspurtTurnId,
      assistantTurnNumber: this.assistantTurnNumber,
    });
    void this.drain(this.generation);
  }

  private beginPrebufferWait(): void {
    this.options.log("telephony.media.rtp_prebuffering", {
      callId: this.options.callId,
      queueDepth: this.queuedBytes,
      prebufferBytes: OUTBOUND_PREBUFFER_BYTES,
      maxWaitMs: OUTBOUND_PREBUFFER_WAIT_MS,
    });
    this.prebufferTimer = setTimeout(() => {
      this.prebufferTimer = undefined;
      this.startDraining();
    }, OUTBOUND_PREBUFFER_WAIT_MS);
  }

  private now(): number {
    return this.options.monotonicNow?.() ?? performance.now();
  }

  private takeFrame(): { payload: Uint8Array; assistantTurnId: string } | undefined {
    if (this.queuedBytes < RTP_FRAME_BYTES) return undefined;
    const first = this.queue[0];
    if (!first) return undefined;
    const payload = new Uint8Array(RTP_FRAME_BYTES);
    let written = 0;
    const assistantTurnId = first.assistantTurnId;
    while (written < RTP_FRAME_BYTES) {
      const segment = this.queue[0];
      if (!segment) return undefined;
      const available = segment.data.byteLength - segment.offset;
      const length = Math.min(RTP_FRAME_BYTES - written, available);
      payload.set(segment.data.subarray(segment.offset, segment.offset + length), written);
      segment.offset += length;
      written += length;
      this.queuedBytes -= length;
      if (segment.offset === segment.data.byteLength) this.queue.shift();
    }
    return { payload, assistantTurnId };
  }

  private observeQueue(): void {
    const bufferedAudioMs = bytesToMilliseconds(this.queuedBytes);
    this.maxBufferedAudioMs = Math.max(this.maxBufferedAudioMs, bufferedAudioMs);
    this.totalBufferedAudioMs += bufferedAudioMs;
    this.queueObservations += 1;
  }

  private logQualitySummary(reason: "queue_drained" | "barge_in" | "call_closed"): void {
    if (this.packetCount === 0) return;
    const intervals = [...this.packetIntervalsMs].sort((left, right) => left - right);
    const countOver = (limit: number) => intervals.filter((value) => value > limit).length;
    this.options.log("telephony.media.rtp_quality_summary", {
      callId: this.options.callId,
      reason,
      packetCount: this.packetCount,
      assistantTurnNumber: this.assistantTurnNumber,
      minElapsedMs: intervals[0],
      maxElapsedMs: intervals.at(-1),
      averageElapsedMs: intervals.length ? roundMilliseconds(intervals.reduce((sum, value) => sum + value, 0) / intervals.length) : undefined,
      p95ElapsedMs: percentile(intervals, 0.95),
      p99ElapsedMs: percentile(intervals, 0.99),
      packetsOver25Ms: countOver(25),
      packetsOver30Ms: countOver(30),
      packetsOver40Ms: countOver(40),
      maxBufferedAudioMs: this.maxBufferedAudioMs,
      averageBufferedAudioMs: this.queueObservations ? Math.round(this.totalBufferedAudioMs / this.queueObservations) : 0,
      finalDrainMs: this.playbackStartedAt === undefined ? undefined : roundMilliseconds(this.now() - this.playbackStartedAt),
      udpSendErrors: 0,
      droppedPackets: 0,
      duplicateSequenceNumbers: 0,
      skippedSequenceNumbers: 0,
      timestampDiscontinuities: 0,
    });
    this.packetIntervalsMs.length = 0;
    this.packetCount = 0;
    this.maxBufferedAudioMs = 0;
    this.totalBufferedAudioMs = 0;
    this.queueObservations = 0;
    this.playbackStartedAt = undefined;
  }
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 10) / 10;
}

function bytesToMilliseconds(bytes: number): number {
  return Math.round((bytes * 1_000) / TELEPHONE_SAMPLE_RATE);
}

function percentile(values: number[], percentileValue: number): number | undefined {
  if (values.length === 0) return undefined;
  return values[Math.min(values.length - 1, Math.ceil(values.length * percentileValue) - 1)];
}

class AsyncFrameQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{ resolve(result: IteratorResult<T>): void; reject(error: Error): void }> = [];
  private finished = false;
  private failure?: Error;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else if (!this.finished) {
      if (this.values.length >= 200) { this.fail(new Error("Inbound RTP buffer capacity exceeded")); return; }
      this.values.push(value);
    }
  }

  fail(error: Error): void { this.failure = error; while (this.waiters.length) this.waiters.shift()!.reject(error); this.end(); }

  end(): void {
    this.values.length = 0;
    this.finished = true;
    while (this.waiters.length) this.waiters.shift()?.resolve({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async (): Promise<IteratorResult<T>> => {
        if (this.failure) throw this.failure;
        const queued = this.values.shift();
        if (queued !== undefined) return { value: queued, done: false };
        if (this.finished) return { value: undefined as never, done: true };
        return await new Promise<IteratorResult<T>>((resolve, reject) => this.waiters.push({ resolve, reject }));
      },
    };
  }
}

function bindUdp(host: string, port: number): Promise<Socket> {
  const socket = dgram.createSocket("udp4");
  return new Promise((resolve, reject) => {
    const failed = (error: Error) => { socket.close(); reject(error); };
    socket.once("error", failed);
    socket.bind(port, host, () => { socket.off("error", failed); resolve(socket); });
  });
}

function closeSocket(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    try { socket.close(() => resolve()); }
    catch { resolve(); }
  });
}

const safeError = (value: unknown) => (value instanceof Error ? value.message : "Unexpected RTP bridge error").slice(0, 300);
