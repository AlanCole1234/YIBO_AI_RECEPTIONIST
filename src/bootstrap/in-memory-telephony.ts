import type { CallTelephonyGateway } from "../modules/calls/index.js";

export class InMemoryCallTelephonyGateway implements CallTelephonyGateway {
  readonly answeredCallIds: string[] = [];
  readonly hungUpCallIds: string[] = [];

  async answer(callId: string): Promise<{ ok: true }> {
    this.answeredCallIds.push(callId);
    return { ok: true };
  }

  async hangup(callId: string): Promise<{ ok: true }> {
    this.hungUpCallIds.push(callId);
    return { ok: true };
  }
}
