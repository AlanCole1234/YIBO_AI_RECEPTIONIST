import { describe, expect, it, vi } from "vitest";
import { AsteriskAriClient } from "../../src/modules/telephony/index.js";
import type { AsteriskEvent } from "../../src/modules/telephony/index.js";

describe("AsteriskAriClient Stasis classification", () => {
  it("ignores an External Media UnicastRTP StasisStart even when ARI app arguments are absent", async () => {
    const logs: Array<{ event: string; details?: Record<string, unknown> }> = [];
    const client = new AsteriskAriClient({
      baseUrl: "http://127.0.0.1:8088",
      application: "yibo",
      username: "test-user",
      password: "test-password",
      logger: (event, details) => logs.push({ event, details }),
    });
    const events: AsteriskEvent[] = [];
    client.onEvent(async (event) => { events.push(event); });

    deliver(client, {
      type: "StasisStart",
      timestamp: "2026-09-10T12:00:00.000Z",
      args: [],
      channel: { id: "external-1", name: "UnicastRTP/100.99.195.117:40000-0x1", caller: { number: "" }, dialplan: { exten: "s" } },
    });
    await tick();

    expect(events).toEqual([]);
    expect(logs).toContainEqual(expect.objectContaining({
      event: "telephony.ari.external_media_stasis_ignored",
      details: expect.objectContaining({ channelId: "external-1", channelTechnology: "UnicastRTP" }),
    }));
  });

  it("forwards a normal caller StasisStart exactly once", async () => {
    const client = new AsteriskAriClient({ baseUrl: "http://127.0.0.1:8088", application: "yibo", username: "test-user", password: "test-password", logger: () => {} });
    const events: AsteriskEvent[] = [];
    client.onEvent(async (event) => { events.push(event); });

    deliver(client, {
      type: "StasisStart",
      timestamp: "2026-09-10T12:00:00.000Z",
      args: ["+529991000000"],
      channel: { id: "caller-1", name: "PJSIP/telnyx-00000001", caller: { number: "+19155550123" }, dialplan: { exten: "yibo" } },
    });
    await tick();

    expect(events).toEqual([expect.objectContaining({ type: "CHANNEL_ENTERED_APPLICATION", channelId: "caller-1", dialedNumber: "+529991000000" })]);
  });
});

function deliver(client: AsteriskAriClient, event: Record<string, unknown>): void {
  (client as unknown as { onMessage(raw: string): void }).onMessage(JSON.stringify(event));
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

 it("aborts an ARI cleanup request that never returns", async () => {
   const original = globalThis.fetch;
   const fetcher = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve,reject) => {
     init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {once:true});
   }));
   globalThis.fetch = fetcher as typeof fetch;
   try {
     const client = new AsteriskAriClient({baseUrl:"http://127.0.0.1:8088",application:"yibo",username:"test",password:"test",logger:()=>{}});
     await expect(client.destroyBridge("test-bridge")).rejects.toMatchObject({name:"TimeoutError"});
     expect(fetcher).toHaveBeenCalledTimes(1);
   } finally { globalThis.fetch = original; }
 }, 6_000);
