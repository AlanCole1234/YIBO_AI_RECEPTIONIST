import { success } from "../shared/domain/result.js";
import type { TelephonyEvent, TelephonyGateway, TransferDestination } from "../modules/telephony/index.js";

export class InMemoryCallTelephonyGateway implements TelephonyGateway {
  readonly answeredCallIds: string[] = [];
  readonly hungUpCallIds: string[] = [];
  readonly transfers: Array<{ callId: string; destination: TransferDestination }> = [];
  private readonly handlers: Array<(event: TelephonyEvent) => Promise<void>> = [];

  async answer(callId: string) {
    this.answeredCallIds.push(callId);
    return success(undefined);
  }

  async hangup(callId: string) {
    this.hungUpCallIds.push(callId);
    return success(undefined);
  }

  async transfer(callId: string, destination: TransferDestination) {
    this.transfers.push({ callId, destination: structuredClone(destination) });
    return success(undefined);
  }

  onEvent(handler: (event: TelephonyEvent) => Promise<void>): void {
    this.handlers.push(handler);
  }

  async emit(event: TelephonyEvent): Promise<void> {
    await Promise.all(this.handlers.map((handler) => handler(event)));
  }
}
