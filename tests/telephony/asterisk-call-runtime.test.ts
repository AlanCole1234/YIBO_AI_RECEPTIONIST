import { describe, expect, it, vi } from "vitest";
import { AsteriskCallRuntime } from "../../src/modules/telephony/index.js";

describe("AsteriskCallRuntime", () => {
  it("starts media before ARI and routes normalized events to the Calls orchestrator", async () => {
    let handler: ((event: { type: "CALL_HUNG_UP"; callId: string; occurredAt: string }) => Promise<void>) | undefined;
    const media = { listen: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
    const ari = { connect: vi.fn(async () => undefined), disconnect: vi.fn() };
    const calls = { handleTelephonyEvent: vi.fn(async () => undefined) };
    const runtime = new AsteriskCallRuntime(ari, { onEvent: (next) => { handler = next; } }, media, calls, 9019, "0.0.0.0");

    await runtime.start();
    expect(media.listen).toHaveBeenCalledWith(9019, "0.0.0.0");
    expect(ari.connect).toHaveBeenCalledTimes(1);
    await handler?.({ type: "CALL_HUNG_UP", callId: "call-1", occurredAt: "2026-08-24T16:00:00.000Z" });
    expect(calls.handleTelephonyEvent).toHaveBeenCalledWith(expect.objectContaining({ callId: "call-1" }));

    await runtime.stop();
    expect(ari.disconnect).toHaveBeenCalledTimes(1);
    expect(media.close).toHaveBeenCalledTimes(1);
  });
});
