import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// Exercise the actual browser playback callbacks without microphone/network access.
function browser() {
  const sent: string[] = [];
  const nodes: Array<{ onended?: () => void; stop(): void }> = [];
  const element = { addEventListener() {}, classList: { add() {}, remove() {} }, setAttribute() {}, style: {}, dataset: {} };
  const sandbox = {
    document: { querySelector: () => element }, location: { host: "localhost" },
    WebSocket: class {
      static OPEN = 1;
      OPEN = 1;
      readyState = 1;
      addEventListener() {}
      send(message: string) { sent.push(message); }
    },
    AudioContext: class {
      currentTime = 0;
      destination = {};
      createBuffer(_channels: number, size: number, rate: number) {
        return { duration: size / rate, getChannelData: () => new Float32Array(size) };
      }
      createBufferSource() {
        const node = { buffer: undefined, connect() {}, start() {}, stop() {}, onended: undefined as (() => void) | undefined };
        nodes.push(node); return node;
      }
    },
    pcm: new Int16Array(480).buffer,
  };
  const script = readFileSync(new URL("../../apps/dev-voice/client.js", import.meta.url), "utf8");
  const controls = runInNewContext(`${script}\n({playPcm16, clearPlayback})`, sandbox);
  return { sent, nodes, controls, pcm: sandbox.pcm };
}
describe("development voice playback completion", () => {
  it("reports idle once after all audio chunks finish, with the newest sequence", () => {
    const value = browser();
    value.controls.playPcm16(value.pcm, { assistantTurnId: "reply", sequence: 1 });
    value.controls.playPcm16(value.pcm, { assistantTurnId: "reply", sequence: 2 });
    value.nodes[0]!.onended!();
    expect(value.sent).toHaveLength(0);
    value.nodes[1]!.onended!();
    expect(value.sent.map(text => JSON.parse(text))).toEqual([{ type: "playback.idle", sequence: 2 }]);
    value.nodes[1]!.onended!();
    expect(value.sent).toHaveLength(1);
  });
  it("does not report a stale natural completion after interruption", () => {
    const value = browser();
    value.controls.playPcm16(value.pcm, { assistantTurnId: "reply", sequence: 1 });
    value.controls.clearPlayback("interrupt");
    value.nodes[0]!.onended!();
    expect(value.sent.map(text => JSON.parse(text).type)).toEqual(["playback.cleared"]);
  });
});
