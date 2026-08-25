import OpenAI from "openai";
import type { OrganizationCostReader, SpendSummary } from "../../modules/billing/index.js";

export interface OrganizationCostsClient {
  costs(input: { start_time: number; end_time: number; bucket_width: "1d"; limit: number }): Promise<{
    data: Array<{
      start_time: number;
      results: Array<{ object: string; amount?: { currency?: string; value?: number } }>;
    }>;
  }>;
}

export class OpenAIOrganizationCostsAdapter implements OrganizationCostReader {
  private cached?: { expiresAt: number; summary: SpendSummary };
  private readonly client: OrganizationCostsClient;

  constructor(adminApiKey: string, client?: OrganizationCostsClient) {
    if (!adminApiKey.trim()) throw new Error("OpenAI organization costs require an admin API key");
    const sdk = client ? undefined : new OpenAI({ apiKey: null, adminAPIKey: adminApiKey });
    this.client = client ?? { costs: (input) => sdk!.admin.organization.usage.costs(input) };
  }

  async summarize(): Promise<SpendSummary> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) return structuredClone(this.cached.summary);
    const current = new Date(now);
    const monthStart = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1) / 1000;
    const end = Math.ceil(now / 1000);
    const response = await this.client.costs({ start_time: monthStart, end_time: end, bucket_width: "1d", limit: 31 });
    let currency = "usd";
    const daily = response.data.map((bucket) => {
      const costs = bucket.results.filter((result) => result.object === "organization.costs.result");
      const amount = costs.reduce((total, result) => total + (result.amount?.value ?? 0), 0);
      currency = costs.find((result) => result.amount?.currency)?.amount?.currency ?? currency;
      return { date: new Date(bucket.start_time * 1000).toISOString().slice(0, 10), amount };
    });
    const sevenDaysAgo = new Date(now - 6 * 86_400_000).toISOString().slice(0, 10);
    const summary: SpendSummary = {
      currency,
      currentMonth: sum(daily.map((value) => value.amount)),
      lastSevenDays: sum(daily.filter((value) => value.date >= sevenDaysAgo).map((value) => value.amount)),
      syncedAt: new Date(now).toISOString(),
      daily,
    };
    this.cached = { expiresAt: now + 5 * 60_000, summary };
    return structuredClone(summary);
  }
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
