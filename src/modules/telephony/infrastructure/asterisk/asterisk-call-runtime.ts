import type { CallOrchestrator } from "../../../calls/index.js";
import type { TelephonyEvent } from "../../application/contracts.js";

export interface AsteriskAriConnection {
  connect(): Promise<void>;
  disconnect(): void;
}

export interface AsteriskEventSource {
  onEvent(handler: (event: TelephonyEvent) => Promise<void>): void;
}

export interface AsteriskMediaListener {
  listen(port: number, host?: string): Promise<void>;
  close(): Promise<void>;
}

/** Starts the Asterisk transport in the only allowed direction: Asterisk → Calls. */
export class AsteriskCallRuntime {
  private started = false;

  constructor(
    private readonly ari: AsteriskAriConnection,
    private readonly telephony: AsteriskEventSource,
    private readonly media: AsteriskMediaListener,
    private readonly calls: CallOrchestrator,
    private readonly mediaPort: number,
    private readonly mediaHost = "127.0.0.1",
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    await this.media.listen(this.mediaPort, this.mediaHost);
    this.telephony.onEvent((event) => this.calls.handleTelephonyEvent(event));
    try {
      await this.ari.connect();
      this.started = true;
    } catch (error) {
      await this.media.close();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.ari.disconnect();
    await this.media.close();
    this.started = false;
  }
}
