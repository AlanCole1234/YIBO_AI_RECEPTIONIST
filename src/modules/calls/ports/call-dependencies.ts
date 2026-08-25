import type { CustomerId, TenantId } from "../../../shared/types/identifiers.js";

export interface CallTelephonyGateway {
  answer(callId: string): Promise<{ ok: true } | { ok: false }>;
  hangup(callId: string): Promise<{ ok: true } | { ok: false }>;
}

export interface CallCustomerDirectory {
  findOrCreateByPhone(input: { tenantId: TenantId; phone: string }): Promise<
    { ok: true; value: { id: CustomerId } } | { ok: false }
  >;
}
