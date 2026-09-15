import type { AudioFrame } from "../../conversation/index.js";

export const REALTIME_SAMPLE_RATE = 24_000;
export const REALTIME_CODEC = "pcm_s16le";

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

/** G.711 µ-law is the narrow-band format used by the Asterisk External Media bridge. */
export const TELEPHONE_SAMPLE_RATE = 8_000;

/** Converts an incoming 8 kHz µ-law RTP payload into the PCM format Realtime expects. */
export function ulawToRealtimeFrame(payload: Uint8Array): AudioFrame {
  const samples = new Float32Array(payload.length);
  for (let index = 0; index < payload.length; index += 1) samples[index] = decodeUlaw(payload[index] ?? 0xff);
  return floatAudioToRealtimeFrame({ samples, sampleRate: TELEPHONE_SAMPLE_RATE, channels: 1 });
}

/** Converts one Realtime PCM frame to an 8 kHz µ-law RTP payload. */
export function realtimeFrameToUlaw(frame: AudioFrame): Uint8Array {
  const converter = new RealtimeToUlawStream();
  return converter.convert(frame);
}

/**
 * Stateful 24 kHz PCM -> 8 kHz PCMU converter for realtime output chunks.
 * A 31-tap windowed-sinc low-pass filter prevents aliasing before decimation.
 * Keep one instance for an entire assistant turn; recreating this per OpenAI
 * delta causes audible discontinuities at chunk boundaries.
 */
export class RealtimeToUlawStream {
  private readonly history = new Float32Array(DECIMATOR_TAPS.length);
  private historyWriteAt = 0;
  private samplesSeen = 0;
  private decimationPhase = 0;

  convert(frame: AudioFrame): Uint8Array {
  if (frame.codec !== REALTIME_CODEC || frame.sampleRate !== REALTIME_SAMPLE_RATE || frame.channels !== 1) {
    throw new Error("Expected mono pcm_s16le at 24000 Hz");
  }
    const output = new Uint8Array(Math.floor(frame.data.byteLength / 6));
    let written = 0;
  const view = new DataView(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
    for (let index = 0; index < frame.data.byteLength / 2; index += 1) {
      this.push(view.getInt16(index * 2, true) / 0x8000);
      this.decimationPhase = (this.decimationPhase + 1) % 3;
      if (this.decimationPhase !== 0) continue;
      output[written] = encodeUlaw(this.filteredSample());
      written += 1;
    }
    return output.subarray(0, written);
  }

  reset(): void {
    this.history.fill(0);
    this.historyWriteAt = 0;
    this.samplesSeen = 0;
    this.decimationPhase = 0;
  }

  private push(sample: number): void {
    this.history[this.historyWriteAt] = sample;
    this.historyWriteAt = (this.historyWriteAt + 1) % this.history.length;
    this.samplesSeen += 1;
  }

  private filteredSample(): number {
    let value = 0;
    const taps = Math.min(this.samplesSeen, DECIMATOR_TAPS.length);
    for (let index = 0; index < taps; index += 1) {
      const sourceIndex = (this.historyWriteAt - 1 - index + this.history.length) % this.history.length;
      value += (this.history[sourceIndex] ?? 0) * (DECIMATOR_TAPS[index] ?? 0);
    }
    return Math.max(-1, Math.min(1, value));
  }
}

/** Exposed for standards-vector tests and telephone codec diagnostics. */
export function pcm16ToUlaw(sample: number): number {
  return encodeUlaw(Math.max(-0x8000, Math.min(0x7fff, Math.round(sample))) / 0x8000);
}

/** Exposed for standards-vector tests and telephone codec diagnostics. */
export function ulawToPcm16(value: number): number {
  return Math.round(decodeUlaw(value) * 0x8000);
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

const DECIMATOR_TAPS = createLowPassTaps(31, 3_400 / REALTIME_SAMPLE_RATE);

function createLowPassTaps(length: number, cutoff: number): Float32Array {
  const taps = new Float32Array(length);
  const center = (length - 1) / 2;
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    const distance = index - center;
    const sinc = distance === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * distance) / (Math.PI * distance);
    const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * index) / (length - 1));
    taps[index] = sinc * hamming;
    total += taps[index] ?? 0;
  }
  for (let index = 0; index < length; index += 1) taps[index] = (taps[index] ?? 0) / total;
  return taps;
}

function decodeUlaw(value: number): number {
  const inverted = (~value) & 0xff;
  const sign = inverted & 0x80;
  const exponent = (inverted >> 4) & 0x07;
  const mantissa = inverted & 0x0f;
  const magnitude = ((mantissa << 3) + 0x84) << exponent;
  const pcm = sign ? 0x84 - magnitude : magnitude - 0x84;
  return Math.max(-1, Math.min(1, pcm / 0x8000));
}

function encodeUlaw(sample: number): number {
  let pcm = Math.round(Math.max(-1, Math.min(1, sample)) * 0x7fff);
  const sign = pcm < 0 ? 0x80 : 0;
  if (pcm < 0) pcm = -pcm;
  pcm = Math.min(32_635, pcm) + 0x84;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && (pcm & mask) === 0; mask >>= 1) exponent -= 1;
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.subarray(offset, offset + length));
}
