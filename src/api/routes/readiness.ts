import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";
import { createAdminGuard } from "../admin-guard.js";

export async function registerReadinessRoutes(server: FastifyInstance, app: YiboApplication) {
  server.get("/api/admin/readiness", { preHandler: createAdminGuard(app, "tenant_admin") }, async () => {
    const stored = await app.business.getBusinessConfiguration(app.tenantId);
    if (!stored.ok) return { ready: false, blockers: ["Business configuration is unavailable"], locations: [] };
    const googleStatus = app.googleOAuth
      ? await app.googleOAuth.status(app.tenantId)
      : { configured: false, connected: false };
    const providers = { ...app.providerReadiness,
      calendar: app.googleOAuth ? googleStatus.connected : app.providerReadiness.calendar };
    const locations = await Promise.all(stored.value.configuration.locations.map(async (location) => {
      const issues: string[] = [];
      if (!location.active) issues.push("Location is disabled");
      if (!location.calledNumbers.length) issues.push("No phone number mapping");
      if (!location.services.some(({ active }) => active)) issues.push("No active services");
      if (!location.professionals.some(({ active }) => active)) issues.push("No active professionals");
      const hasCalendarRoute = Boolean(location.defaultCalendarId || location.professionals.some(({ calendarId }) => calendarId));
      if (!hasCalendarRoute) issues.push("No calendar route");
      else if (app.googleOAuth && !googleStatus.connected) issues.push("Google Calendar connection must be renewed");
      else if (app.googleOAuth) {
        const effectiveCalendarIds = [...new Set(location.professionals
          .filter(({ active }) => active)
          .map(({ calendarId }) => calendarId ?? location.defaultCalendarId)
          .filter((calendarId): calendarId is string => Boolean(calendarId)))];
        const access = await Promise.all(effectiveCalendarIds
          .map((calendarId) => app.googleOAuth!.verifyCalendarAccess(app.tenantId, calendarId)));
        if (access.some((status) => status !== "accessible")) issues.push("One or more calendar routes are not accessible");
      }
      if (!location.openingHours.length) issues.push("No business hours");
      return { id: location.id, name: location.name, ready: issues.length === 0, issues };
    }));
    const blockers = Object.entries(providers).filter(([, ready]) => !ready)
      .map(([provider]) => provider === "calendar" && googleStatus.configured
        ? "Google Calendar connection must be renewed"
        : `${provider} provider is not configured`);
    return { ready: blockers.length === 0 && locations.every(({ ready }) => ready), blockers, locations,
      providers };
  });
}
