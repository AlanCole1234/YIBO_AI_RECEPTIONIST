import { REALTIME_AUDIO_TRANSPORT, type AudioFrame } from "../../conversation/index.js";

export const REALTIME_SAMPLE_RATE = REALTIME_AUDIO_TRANSPORT.sampleRate;
export const REALTIME_CODEC = REALTIME_AUDIO_TRANSPORT.codec;

export interface FloatAudioChunk {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
}

export function floatAudioToRealtimeFrame(chunk: FloatAudioChunk): AudioFrame {
  if (chunk.sampleRate <= 0 || chunk.channels < 1) throw new Error("Invalid audio metadata");
  const mono = mixToMono(chunk.samples, chunk.channels);
  const resampled = resampleLinear(mono, chunk.sampleRate, REALTIME_SAMPLE_RATE);
  const data = new Uint8Array(resampled.length * 2);
  const view = new DataView(data.buffer);
  for (let index = 0; index < resampled.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, resampled[index] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return { data, codec: REALTIME_CODEC, sampleRate: REALTIME_SAMPLE_RATE, channels: 1 };
}

export function decodeWav(data: Uint8Array): FloatAudioChunk {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (ascii(data, 0, 4) !== "RIFF" || ascii(data, 8, 4) !== "WAVE") {
    throw new Error("Fixture must be a RIFF/WAVE file");
  }
  let format: { encoding: number; channels: number; sampleRate: number; bits: number } | undefined;
  let audioOffset = -1;
  let audioLength = 0;
  for (let offset = 12; offset + 8 <= data.byteLength;) {
    const id = ascii(data, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + length > data.byteLength) throw new Error("Invalid WAV chunk length");
    if (id === "fmt ") {
      format = {
        encoding: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      audioOffset = body;
      audioLength = length;
    }
    offset = body + length + (length % 2);
  }
  if (!format || audioOffset < 0) throw new Error("WAV is missing fmt or data chunks");
  if (format.channels < 1 || format.sampleRate < 1) throw new Error("Invalid WAV audio metadata");
  const bytesPerSample = format.bits / 8;
  if (!Number.isInteger(bytesPerSample) || bytesPerSample < 1) throw new Error("Unsupported WAV bit depth");
  const count = Math.floor(audioLength / bytesPerSample);
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = audioOffset + index * bytesPerSample;
    if (format.encoding === 1 && format.bits === 16) samples[index] = view.getInt16(offset, true) / 0x8000;
    else if (format.encoding === 3 && format.bits === 32) samples[index] = view.getFloat32(offset, true);
    else throw new Error(`Unsupported WAV format: encoding=${format.encoding}, bits=${format.bits}`);
  }
  return { samples, sampleRate: format.sampleRate, channels: format.channels };
}

export function splitRealtimeFrame(frame: AudioFrame, durationMs = 20): AudioFrame[] {
  if (frame.codec !== REALTIME_CODEC || frame.sampleRate !== REALTIME_SAMPLE_RATE || frame.channels !== 1) {
    throw new Error("Expected mono pcm_s16le at 24000 Hz");
  }
  const bytesPerFrame = Math.round((frame.sampleRate * 2 * durationMs) / 1_000);
  const frames: AudioFrame[] = [];
  for (let offset = 0; offset < frame.data.byteLength; offset += bytesPerFrame) {
    frames.push({ ...frame, data: frame.data.slice(offset, offset + bytesPerFrame) });
  }
  return frames;
}

function mixToMono(samples: Float32Array, channels: number): Float32Array {
  const length = Math.floor(samples.length / channels);
  const mono = new Float32Array(length);
  for (let frame = 0; frame < length; frame += 1) {
    let value = 0;
    for (let channel = 0; channel < channels; channel += 1) value += samples[frame * channels + channel] ?? 0;
    mono[frame] = value / channels;
  }
  return mono;
}

function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples;
  const length = Math.max(1, Math.round(samples.length * toRate / fromRate));
  const output = new Float32Array(length);
  const ratio = fromRate / toRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = samples[Math.min(left, samples.length - 1)] ?? 0;
    const b = samples[Math.min(left + 1, samples.length - 1)] ?? a;
    output[index] = a + (b - a) * fraction;
  }
  return output;
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.subarray(offset, offset + length));
}
