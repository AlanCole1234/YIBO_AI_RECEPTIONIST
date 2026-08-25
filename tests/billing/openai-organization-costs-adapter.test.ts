import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenAIOrganizationCostsAdapter,
  type OrganizationCostsClient,
} from "../../src/infrastructure/billing/openai-organization-costs-adapter.js";

describe("OpenAIOrganizationCostsAdapter", () => {
  afterEach(() => vi.useRealTimers());

  it("aggregates official daily costs without exposing the admin key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00.000Z"));
    const costs = vi.fn<OrganizationCostsClient["costs"]>().mockResolvedValue({
      data: [
        bucket("2026-08-18", 1.25),
        bucket("2026-08-20", 0.5),
        bucket("2026-08-25", 0.75),
      ],
    });
    const adapter = new OpenAIOrganizationCostsAdapter("admin-secret", { costs });

    await expect(adapter.summarize()).resolves.toMatchObject({
      currency: "usd",
      currentMonth: 2.5,
      lastSevenDays: 1.25,
      syncedAt: "2026-08-25T12:00:00.000Z",
    });
    expect(costs).toHaveBeenCalledOnce();
    await adapter.summarize();
    expect(costs).toHaveBeenCalledOnce();
  });
});

const bucket = (date: string, value: number) => ({
  start_time: Date.parse(`${date}T00:00:00.000Z`) / 1000,
  results: [{ object: "organization.costs.result", amount: { currency: "usd", value } }],
});
