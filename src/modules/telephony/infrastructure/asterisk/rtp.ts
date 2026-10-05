/** RFC 3550 helpers for the fixed G.711 µ-law (payload type 0) media bridge. */
export const RTP_ULAW_PAYLOAD_TYPE = 0;

export interface RtpPacket {
  payloadType: number;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
  marker: boolean;
  payload: Uint8Array;
}

export function parseRtpPacket(packet: Uint8Array): RtpPacket | null {
  if (packet.byteLength < 12 || (packet[0] ?? 0) >> 6 !== 2) return null;
  const csrcCount = (packet[0] ?? 0) & 0x0f;
  const hasExtension = ((packet[0] ?? 0) & 0x10) !== 0;
  let offset = 12 + csrcCount * 4;
  if (offset > packet.byteLength) return null;
  if (hasExtension) {
    if (offset + 4 > packet.byteLength) return null;
    const words = ((packet[offset + 2] ?? 0) << 8) | (packet[offset + 3] ?? 0);
    offset += 4 + words * 4;
  }
  if (offset > packet.byteLength) return null;
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  return {
    payloadType: (packet[1] ?? 0) & 0x7f,
    marker: ((packet[1] ?? 0) & 0x80) !== 0,
    sequenceNumber: view.getUint16(2),
    timestamp: view.getUint32(4),
    ssrc: view.getUint32(8),
    payload: packet.slice(offset),
  };
}

export function createRtpPacket(packet: Omit<RtpPacket, "payloadType"> & { payloadType?: number; marker?: boolean }): Uint8Array {
  const payloadType = packet.payloadType ?? RTP_ULAW_PAYLOAD_TYPE;
  const output = new Uint8Array(12 + packet.payload.byteLength);
  const view = new DataView(output.buffer);
  output[0] = 0x80;
  output[1] = (packet.marker ? 0x80 : 0) | (payloadType & 0x7f);
  view.setUint16(2, packet.sequenceNumber & 0xffff);
  view.setUint32(4, packet.timestamp >>> 0);
  view.setUint32(8, packet.ssrc >>> 0);
  output.set(packet.payload, 12);
  return output;
}
