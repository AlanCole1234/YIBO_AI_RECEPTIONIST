export interface SpendSummary {
  currency: string;
  currentMonth: number;
  lastSevenDays: number;
  syncedAt: string;
  daily: Array<{ date: string; amount: number }>;
}

export interface OrganizationCostReader {
  summarize(): Promise<SpendSummary>;
}
