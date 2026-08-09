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

export interface CallAgentSession {
  close(): Promise<void>;
}

export interface CallAgentRuntime {
  startSession(input: { callId: string; tenantId: TenantId; customerId?: CustomerId }): Promise<
    { ok: true; value: CallAgentSession } | { ok: false }
  >;
}

export interface CallVoiceSession {
  close(): Promise<void>;
}

export interface CallVoiceBridge {
  start(input: { callId: string; agentSession: CallAgentSession }): Promise<
    { ok: true; value: CallVoiceSession } | { ok: false }
  >;
}
