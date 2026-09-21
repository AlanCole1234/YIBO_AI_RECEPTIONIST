import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";
import { createAdminGuard } from "../admin-guard.js";

export async function registerReadinessRoutes(server: FastifyInstance, app: YiboApplication) {
  server.get("/api/admin/readiness", { preHandler: createAdminGuard(app, "tenant_admin") }, async () => {
    const stored = await app.business.getBusinessConfiguration(app.tenantId);
    if (!stored.ok) return { ready: false, blockers: ["Business configuration is unavailable"], locations: [] };
    const locations = stored.value.configuration.locations.map((location) => {
      const issues: string[] = [];
      if (!location.active) issues.push("Location is disabled");
      if (!location.calledNumbers.length) issues.push("No phone number mapping");
      if (!location.services.some(({ active }) => active)) issues.push("No active services");
      if (!location.professionals.some(({ active }) => active)) issues.push("No active professionals");
      if (!location.defaultCalendarId && !location.professionals.some(({ calendarId }) => calendarId)) issues.push("No calendar route");
      if (!location.openingHours.length) issues.push("No business hours");
      return { id: location.id, name: location.name, ready: issues.length === 0, issues };
    });
    const blockers = Object.entries(app.providerReadiness).filter(([, ready]) => !ready)
      .map(([provider]) => `${provider} provider is not configured`);
    return { ready: blockers.length === 0 && locations.every(({ ready }) => ready), blockers, locations,
      providers: app.providerReadiness };
  });
}
