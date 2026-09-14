export const REALTIME_AUDIO_TRANSPORT = Object.freeze({
  modality: "audio" as const,
  codec: "pcm_s16le" as const,
  sampleRate: 24_000 as const,
  channels: 1 as const,
  providerFormat: Object.freeze({ type: "audio/pcm" as const, rate: 24_000 as const }),
});
