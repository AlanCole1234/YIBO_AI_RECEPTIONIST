/** Checks preview readiness, not authentication; the server still owns tenant selection. */
export function voiceLabConnection(location: Pick<Location, "protocol" | "hostname" | "host">, development: boolean): { url: string; hosted: boolean } {
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) || location.hostname.endsWith(".localhost");
  const local = development && loopback && location.protocol === "http:";
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return { hosted: !local, url: local ? `${protocol}//${location.hostname}:4317/voice`
    : `${protocol}//${location.host}/api/voice-lab/stream` };
}

export function previewBlockReason(expectedTenantId: string | undefined, metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return "Waiting for Voice Lab to identify its saved configuration.";
  if (!expectedTenantId || metadata.tenantId !== expectedTenantId) return "Voice Lab is configured for a different tenant. Update its server configuration before previewing.";
  if (metadata.runtime !== "openai-realtime") return "Voice Lab needs an OpenAI Realtime runtime for a real voice preview.";
  if (metadata.configurationSource !== "saved" || typeof metadata.model !== "string" || typeof metadata.voice !== "string") {
    return "Voice Lab did not identify its saved model and voice.";
  }
  return undefined;
}
