import type { Clock } from "../../../shared/application/system.js";
import { failure, success } from "../../../shared/domain/result.js";
import type { HumanTransferPort } from "../../agents/index.js";
import type { BusinessDirectory } from "../../business/index.js";
import type { CallRepository } from "../../calls/index.js";
import type { TelephonyGateway } from "../../telephony/index.js";

export class TelephonyHumanTransferAdapter implements HumanTransferPort {
  constructor(
    private readonly businesses: BusinessDirectory,
    private readonly calls: CallRepository,
    private readonly telephony: TelephonyGateway,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  async transferToConfiguredDestination(input: { tenantId: string; locationId: string; callId: string }) {
    const [location, call] = await Promise.all([
      this.businesses.getLocation(input.tenantId, input.locationId),
      this.calls.findByCallId(input.callId),
    ]);
    if (!location.ok || !location.value.location.transferDestination) {
      return failure({ code: "DESTINATION_NOT_CONFIGURED" as const, retryable: false });
    }
    if (!call || call.tenantId !== input.tenantId || call.locationId !== input.locationId
      || call.state !== "IN_CONVERSATION") {
      return failure({ code: "TRANSFER_FAILED" as const, retryable: false });
    }

    await this.calls.updateState(input.callId, "TRANSFERRING", this.clock.now().toISOString());
    try {
      const transferred = await this.telephony.transfer(input.callId, location.value.location.transferDestination);
      if (!transferred.ok) {
        await this.calls.updateState(input.callId, "IN_CONVERSATION", this.clock.now().toISOString());
        return failure({
          code: "TRANSFER_FAILED" as const,
          retryable: transferred.error.code === "PROVIDER_UNAVAILABLE" && transferred.error.retryable,
        });
      }
      await this.calls.updateState(input.callId, "TRANSFERRED", this.clock.now().toISOString());
      return success(undefined);
    } catch {
      await this.calls.updateState(input.callId, "IN_CONVERSATION", this.clock.now().toISOString());
      return failure({ code: "TRANSFER_FAILED" as const, retryable: true });
    }
  }
}
