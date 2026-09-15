import { afterEach, describe, expect, it, vi } from "vitest";
import { PcmuRtpPacer } from "../../src/modules/telephony/infrastructure/asterisk/asterisk-rtp-voice-media-gateway.js";
import { TELEPHONE_SAMPLE_RATE } from "../../src/modules/voice/index.js";

afterEach(() => vi.useRealTimers());

describe("PcmuRtpPacer", () => {
  it("splits a 3200-byte Realtime output chunk into paced 160-byte RTP payloads", async () => {
    vi.useFakeTimers();
    const packets: Array<{ bytes: number; turn: string; queueDepth: number }> = [];
    const pacer = new PcmuRtpPacer({
      callId: "call-1",
      send: async (payload, assistantTurnId, queueDepth) => { packets.push({ bytes: payload.byteLength, turn: assistantTurnId, queueDepth }); },
      log: () => {},
    });

    pacer.enqueue(new Uint8Array(3_200), "assistant-1");
    await vi.runAllTimersAsync();

    expect(packets).toHaveLength(20);
    expect(packets.every((packet) => packet.bytes === 160 && packet.turn === "assistant-1")).toBe(true);
    expect(packets[0]?.queueDepth).toBe(3_040);
    expect(packets.at(-1)?.queueDepth).toBe(0);
  });

  it("combines partial chunks and can resume normally after barge-in clears queued audio", async () => {
    vi.useFakeTimers();
    const packets: number[] = [];
    const pacer = new PcmuRtpPacer({ callId: "call-1", send: async (payload) => { packets.push(payload.byteLength); }, log: () => {} });

    pacer.enqueue(new Uint8Array(100), "assistant-1");
    pacer.enqueue(new Uint8Array(60), "assistant-1");
    await vi.runAllTimersAsync();
    pacer.clear("barge_in");
    pacer.enqueue(new Uint8Array(160), "assistant-2");
    await vi.runAllTimersAsync();

    expect(packets).toEqual([160, 160]);
  });

  it("prebuffers short output and sends frames on a monotonic 20 ms schedule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    const timing: Array<{ elapsedMs?: number; queueBecameEmpty: boolean; talkspurtStarted: boolean }> = [];
    const events: string[] = [];
    const pacer = new PcmuRtpPacer({
      callId: "call-1",
      send: async (_payload, _assistantTurnId, _queueDepth, details) => { timing.push(details); },
      log: (event) => { events.push(event); },
      monotonicNow: () => Date.now(),
    });

    pacer.enqueue(new Uint8Array(160), "assistant-1");
    expect(timing).toEqual([]);
    expect(events).toContain("telephony.media.rtp_prebuffering");

    await vi.advanceTimersByTimeAsync(80);
    expect(timing).toHaveLength(1);

    pacer.enqueue(new Uint8Array(480), "assistant-1");
    await vi.advanceTimersByTimeAsync(80);
    await vi.advanceTimersByTimeAsync(60);

    // A new talkspurt starts from a fresh pacing epoch after the short gap;
    // it must not burst packets to compensate for the 80 ms silence.
    expect(timing.map((packet) => packet.elapsedMs)).toEqual([undefined, 80, 20, 20]);
    expect(timing.map((packet) => packet.talkspurtStarted)).toEqual([true, true, false, false]);
    expect(timing.at(-1)?.queueBecameEmpty).toBe(true);
  });

  it("retains a normal-length response instead of discarding audio when Realtime produces it quickly", () => {
    const events: string[] = [];
    const pacer = new PcmuRtpPacer({
      callId: "call-1",
      send: async () => {},
      log: (event) => { events.push(event); },
    });

    // Ten seconds at 8 kHz PCMU is a normal single assistant response.
    pacer.enqueue(new Uint8Array(TELEPHONE_SAMPLE_RATE * 10), "assistant-1");

    expect(events).not.toContain("telephony.media.rtp_queue_trimmed");
    pacer.stop("call_closed");
  });

  it("starts five assistant talkspurts from fresh pacing epochs without burst catch-up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    const packets: Array<{ turn: string; timing: { elapsedMs?: number; talkspurtStarted: boolean } }> = [];
    const pacer = new PcmuRtpPacer({
      callId: "call-1",
      send: async (_payload, assistantTurnId, _queueDepth, timing) => { packets.push({ turn: assistantTurnId, timing }); },
      log: () => {},
      monotonicNow: () => Date.now(),
    });

    for (let turn = 1; turn <= 5; turn += 1) {
      pacer.enqueue(new Uint8Array(640), `assistant-${turn}`);
      await vi.advanceTimersByTimeAsync(60);
      await vi.advanceTimersByTimeAsync(500);
    }

    expect(packets).toHaveLength(20);
    expect(packets.filter((packet) => packet.timing.talkspurtStarted)).toHaveLength(5);
    for (let turn = 1; turn <= 5; turn += 1) {
      const turnPackets = packets.filter((packet) => packet.turn === `assistant-${turn}`);
      expect(turnPackets).toHaveLength(4);
      expect(turnPackets.slice(1).map((packet) => packet.timing.elapsedMs)).toEqual([20, 20, 20]);
    }
  });
  it("rejects excess output without dropping already queued speech", () => {
    vi.useFakeTimers();
    const pacer = new PcmuRtpPacer({callId:"capacity", send:async()=>{}, log:()=>{}});
    pacer.enqueue(new Uint8Array(8000),"first");
    const bufferedBefore = pacer.queueDepth();
    expect(()=>pacer.enqueue(new Uint8Array(240001),"second")).toThrow("capacity");
    expect(pacer.queueDepth()).toBe(bufferedBefore);
    pacer.stop("call_closed");
  });

});
