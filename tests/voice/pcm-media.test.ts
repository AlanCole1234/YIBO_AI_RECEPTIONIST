import { describe, expect, it } from "vitest";
import {
  decodeWav,
  floatAudioToRealtimeFrame,
  splitRealtimeFrame,
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
});

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
