import { it, expect } from "vitest";
import { OpenAIRealtimeAdapter } from "../../src/modules/conversation/index.js";

const liveIt = process.env.OPENAI_API_KEY ? it : it.skip;

liveIt("asks for availability through a real Realtime tool call", async () => {
  const adapter = new OpenAIRealtimeAdapter({
    apiKey: process.env.OPENAI_API_KEY!,
    model: process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime-2.1",
    maxOutputTokens: 160,
    mode: "text",
  });
  const session = await adapter.openSession({
    conversationId: "optional-live-availability-check",
    agent: {
      instructions: "You are a concise receptionist. Always use check_availability before offering a time.",
      locale: "es-MX",
      conversation: {
        model: process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime-2.1",
        maxOutputTokens: 160,
        reasoningEffort: "minimal",
        tracing: "disabled",
        truncation: { mode: "auto" },
      },
      audio: {
        voice: "marin",
        noiseReduction: "near_field",
        turnDetection: { type: "server_vad", createResponse: true, interruptResponse: true },
      },
      tools: [{
        name: "check_availability",
        description: "Find available appointment slots.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["serviceId", "rangeStart", "rangeEnd"],
          properties: {
            serviceId: { type: "string" },
            rangeStart: { type: "string" },
            rangeEnd: { type: "string" },
          },
        },
      }],
    },
  });

  try {
    await session.sendText(
      "Necesito una consulta mañana. Revisa disponibilidad antes de responder.",
    );
    for await (const event of session.events()) {
      if (event.type === "error") throw new Error(`${event.code}: ${event.message}`);
      if (event.type !== "tool.call") continue;
      expect(event.name).toBe("check_availability");
      await session.sendToolResult({
        toolCallId: event.toolCallId,
        ok: true,
        data: {
          slots: [
            { employeeId: "employee-1", startAt: "2026-08-26T16:30:00.000Z", endAt: "2026-08-26T17:00:00.000Z" },
          ],
        },
      });
      return;
    }
    throw new Error("Realtime session closed before requesting availability");
  } finally {
    await session.close();
  }
}, 30_000);
