import type { CallId } from "../../../../shared/types/identifiers.js";

export class AsteriskCallRegistry {
  private readonly channelToCall = new Map<string, CallId>();
  private readonly callToChannel = new Map<CallId, string>();
  private readonly callToMediaStream = new Map<CallId, string>();

  constructor(private readonly createCallId: () => CallId) {}

  register(channelId: string, mediaStreamId?: string): CallId {
    const existing = this.channelToCall.get(channelId);
    if (existing) {
      if (mediaStreamId) this.callToMediaStream.set(existing, mediaStreamId);
      return existing;
    }
    const callId = this.createCallId();
    this.channelToCall.set(channelId, callId);
    this.callToChannel.set(callId, channelId);
    if (mediaStreamId) this.callToMediaStream.set(callId, mediaStreamId);
    return callId;
  }

  callIdForChannel(channelId: string): CallId | null {
    return this.channelToCall.get(channelId) ?? null;
  }

  channelIdForCall(callId: CallId): string | null {
    return this.callToChannel.get(callId) ?? null;
  }

  mediaStreamIdForCall(callId: CallId): string | null {
    return this.callToMediaStream.get(callId) ?? null;
  }

  setMediaStreamId(callId: CallId, mediaStreamId: string): void {
    if (this.callToChannel.has(callId)) this.callToMediaStream.set(callId, mediaStreamId);
  }

  unregisterChannel(channelId: string): CallId | null {
    const callId = this.channelToCall.get(channelId);
    if (!callId) return null;
    this.channelToCall.delete(channelId);
    this.callToChannel.delete(callId);
    this.callToMediaStream.delete(callId);
    return callId;
  }
}
