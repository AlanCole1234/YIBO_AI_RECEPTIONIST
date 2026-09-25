import type { EmailMessage, EmailSender } from "../application/contracts.js";

export class ResendEmailSender implements EmailSender {
  constructor(private readonly apiKey: string, private readonly from: string) {}
  async send(message: EmailMessage) {
    try {
      const response = await fetch("https://api.resend.com/emails", { method: "POST", signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text }) });
      if (!response.ok) return { ok: false as const, code: response.status === 429 ? "RATE_LIMITED" : "PROVIDER_REJECTED" };
      const body = await response.json() as { id?: string };
      return body.id ? { ok: true as const, messageId: body.id } : { ok: false as const, code: "INVALID_PROVIDER_RESPONSE" };
    } catch { return { ok: false as const, code: "PROVIDER_UNAVAILABLE" }; }
  }
}
