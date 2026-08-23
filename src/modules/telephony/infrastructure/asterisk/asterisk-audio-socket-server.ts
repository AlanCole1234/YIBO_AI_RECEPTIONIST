import { createServer, type Server, type Socket } from "node:net";
import type { AudioFrame, AudioSink } from "../../../voice/index.js";

const CODECS: Record<number, { codec: string; sampleRateHz: number }> = {
  0x10: { codec: "pcm_s16le", sampleRateHz: 8_000 },
  0x11: { codec: "pcm_s16le", sampleRateHz: 12_000 },
  0x12: { codec: "pcm_s16le", sampleRateHz: 16_000 },
  0x13: { codec: "pcm_s16le", sampleRateHz: 24_000 },
  0x14: { codec: "pcm_s16le", sampleRateHz: 32_000 },
  0x15: { codec: "pcm_s16le", sampleRateHz: 44_100 },
  0x16: { codec: "pcm_s16le", sampleRateHz: 48_000 },
  0x17: { codec: "pcm_s16le", sampleRateHz: 96_000 },
  0x18: { codec: "pcm_s16le", sampleRateHz: 192_000 },
};

export interface AsteriskAudioSession {
  readonly streamId: string;
  readonly inboundAudio: AsyncIterable<AudioFrame>;
  readonly outboundAudio: AudioSink;
  close(): Promise<void>;
}

/**
 * AudioSocket is Asterisk's TCP media protocol. Keeping its packet framing in
 * this adapter lets the Voice module work only with AudioFrame/AudioSink.
 */
export class AsteriskAudioSocketServer {
  private readonly sessions = new Map<string, AudioSocketSession>();
  private readonly waiters = new Map<string, Array<(session: AudioSocketSession) => void>>();
  private server?: Server;

  async listen(port: number, host = "127.0.0.1"): Promise<void> {
    if (this.server) return;
    const server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => { server.off("error", reject); resolve(); });
    });
    this.server = server;
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) await session.close();
    this.sessions.clear();
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  async waitForSession(streamId: string, timeoutMs = 10_000): Promise<AsteriskAudioSession> {
    const existing = this.sessions.get(streamId);
    if (existing) return existing;
    return new Promise<AsteriskAudioSession>((resolve, reject) => {
      const receive = (session: AudioSocketSession) => {
        clearTimeout(timeout);
        resolve(session);
      };
      const timeout = setTimeout(() => {
        const waiters = this.waiters.get(streamId) ?? [];
        this.waiters.set(streamId, waiters.filter((waiter) => waiter !== receive));
        reject(new Error("Asterisk AudioSocket connection timed out"));
      }, timeoutMs);
      this.waiters.set(streamId, [...(this.waiters.get(streamId) ?? []), receive]);
    });
  }

  private accept(socket: Socket): void {
    const session = new AudioSocketSession(socket, (streamId, identified) => {
      this.sessions.set(streamId, identified);
      const waiters = this.waiters.get(streamId) ?? [];
      this.waiters.delete(streamId);
      for (const waiter of waiters) waiter(identified);
    }, (streamId) => this.sessions.delete(streamId));
  }
}

class AudioSocketSession implements AsteriskAudioSession {
  private readonly queue = new AsyncFrameQueue();
  private buffered = Buffer.alloc(0);
  private identified = false;
  private closed = false;
  private streamIdValue?: string;

  constructor(
    private readonly socket: Socket,
    private readonly onIdentified: (streamId: string, session: AudioSocketSession) => void,
    private readonly onClosed: (streamId: string) => void,
  ) {
    socket.on("data", (chunk: Buffer) => this.consume(chunk));
    socket.once("close", () => this.finish());
    socket.once("error", () => this.finish());
  }

  get streamId(): string {
    if (!this.streamIdValue) throw new Error("AudioSocket session has not supplied its UUID");
    return this.streamIdValue;
  }

  get inboundAudio(): AsyncIterable<AudioFrame> { return this.queue; }

  readonly outboundAudio: AudioSink = {
    write: async (frame) => {
      const type = Object.entries(CODECS).find(([, value]) => value.codec === frame.codec && value.sampleRateHz === frame.sampleRateHz)?.[0];
      if (!type || frame.data.byteLength > 0xffff) throw new Error("Unsupported Asterisk AudioSocket frame");
      const header = Buffer.alloc(3);
      header[0] = Number(type);
      header.writeUInt16BE(frame.data.byteLength, 1);
      await new Promise<void>((resolve, reject) => this.socket.write(Buffer.concat([header, Buffer.from(frame.data)]), (error) => error ? reject(error) : resolve()));
    },
  };

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.socket.end(Buffer.from([0x00, 0x00, 0x00]));
    this.queue.end();
    if (this.streamIdValue) this.onClosed(this.streamIdValue);
  }

  private consume(chunk: Buffer): void {
    this.buffered = Buffer.concat([this.buffered, chunk]);
    while (this.buffered.length >= 3) {
      const type = this.buffered[0]!;
      const length = this.buffered.readUInt16BE(1);
      if (this.buffered.length < length + 3) return;
      const payload = this.buffered.subarray(3, length + 3);
      this.buffered = this.buffered.subarray(length + 3);
      this.handlePacket(type, payload);
    }
  }

  private handlePacket(type: number, payload: Buffer): void {
    if (type === 0x00) return void this.finish();
    if (type === 0x01 && payload.length === 16 && !this.identified) {
      this.streamIdValue = uuidFromBytes(payload);
      this.identified = true;
      this.onIdentified(this.streamIdValue, this);
      return;
    }
    const codec = CODECS[type];
    if (codec && this.identified && payload.length > 0) {
      this.queue.push({ data: new Uint8Array(payload), ...codec });
    }
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue.end();
    if (this.streamIdValue) this.onClosed(this.streamIdValue);
  }
}

class AsyncFrameQueue implements AsyncIterable<AudioFrame> {
  private readonly frames: AudioFrame[] = [];
  private readonly waiters: Array<(result: IteratorResult<AudioFrame>) => void> = [];
  private ended = false;

  push(frame: AudioFrame): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value: frame });
    else if (!this.ended) this.frames.push(frame);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<AudioFrame> {
    return {
      next: async () => {
        const frame = this.frames.shift();
        if (frame) return { done: false, value: frame };
        if (this.ended) return { done: true, value: undefined };
        return new Promise<IteratorResult<AudioFrame>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

export const uuidFromBytes = (bytes: Buffer): string => {
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};
