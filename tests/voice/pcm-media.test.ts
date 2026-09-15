import { describe, expect, it } from "vitest";
import {
  decodeWav,
  floatAudioToRealtimeFrame,
  realtimeFrameToUlaw,
  RealtimeToUlawStream,
  splitRealtimeFrame,
  pcm16ToUlaw,
  ulawToPcm16,
  ulawToRealtimeFrame,
} from "../../src/modules/voice/index.js";

describe("voice/media PCM conversion", () => {
  it("mixes and resamples float microphone audio to Realtime PCM", () => {
    const frame = floatAudioToRealtimeFrame({
      samples: new Float32Array([1, -1, 0.5, 0.5]),
      sampleRate: 48_000,
      channels: 2,
    });
    expect(frame).toMatchObject({ codec: "pcm_s16le", sampleRate: 24_000, channels: 1 });
    expect(frame.data.byteLength).toBe(2);
  });

  it("decodes PCM16 WAV fixtures and creates 20ms transport frames", () => {
    const wav = pcm16Wav([0, 16_384, -16_384], 24_000, 1);
    const decoded = decodeWav(wav);
    expect(decoded.sampleRate).toBe(24_000);
    expect(Array.from(decoded.samples)).toEqual([0, 0.5, -0.5]);
    const frame = floatAudioToRealtimeFrame(decoded);
    expect(splitRealtimeFrame(frame, 20)).toHaveLength(1);
  });

  it("converts G.711 µ-law telephone audio to the Realtime format and back", () => {
    const inbound = ulawToRealtimeFrame(new Uint8Array(160).fill(0xff));
    expect(inbound).toMatchObject({ codec: "pcm_s16le", sampleRate: 24_000, channels: 1 });
    expect(inbound.data.byteLength).toBe(960);

    const outbound = realtimeFrameToUlaw(inbound);
    expect(outbound).toHaveLength(160);
    expect(outbound.every((byte) => Number.isInteger(byte))).toBe(true);
  });

  it("keeps decimation continuous across OpenAI audio chunk boundaries", () => {
    const samples = new Int16Array(9_600);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.round(Math.sin(index / 9) * 12_000);
    const frame = pcmFrame(samples);
    const allAtOnce = new RealtimeToUlawStream().convert(frame);
    const streaming = new RealtimeToUlawStream();
    const chunks = [
      streaming.convert({ ...frame, data: frame.data.slice(0, 3_840) }),
      streaming.convert({ ...frame, data: frame.data.slice(3_840, 11_520) }),
      streaming.convert({ ...frame, data: frame.data.slice(11_520) }),
    ];
    expect(Array.from(concat(chunks))).toEqual(Array.from(allAtOnce));
    expect(allAtOnce).toHaveLength(3_200);
  });

  it("matches core G.711 µ-law vectors without clipping wraparound", () => {
    expect(pcm16ToUlaw(0)).toBe(0xff);
    expect(pcm16ToUlaw(32_767)).toBe(0x80);
    expect(pcm16ToUlaw(-32_768)).toBe(0);
    expect(ulawToPcm16(0xff)).toBe(0);
    expect(ulawToPcm16(0x80)).toBeGreaterThan(32_000);
    expect(ulawToPcm16(0)).toBeLessThan(-32_000);
  });
});

function pcmFrame(samples: Int16Array) {
  return {
    data: new Uint8Array(samples.buffer.slice(0)),
    codec: "pcm_s16le",
    sampleRate: 24_000,
    channels: 1,
  } as const;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}

function pcm16Wav(samples: number[], sampleRate: number, channels: number): Uint8Array {
  const dataLength = samples.length * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  write(bytes, 0, "RIFF"); view.setUint32(4, 36 + dataLength, true); write(bytes, 8, "WAVE");
  write(bytes, 12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true); write(bytes, 36, "data"); view.setUint32(40, dataLength, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return bytes;
}

function write(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}
