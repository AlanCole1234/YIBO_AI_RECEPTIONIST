import type { YiboApplication } from "../bootstrap/index.js";
import type { GoogleCalendarAccessStatus } from "../modules/integrations/index.js";

export const verifyCalendarAccess = (
  app: YiboApplication,
  calendarId: string,
): Promise<GoogleCalendarAccessStatus> => app.googleOAuth?.verifyCalendarAccess(app.tenantId, calendarId)
  ?? Promise.resolve("integration_not_configured");

export const calendarMappings = (configuration: unknown): Map<string, string> => {
  const mappings = new Map<string, string>();
  if (!isRecord(configuration) || !Array.isArray(configuration.locations)) return mappings;
  for (const location of configuration.locations) {
    if (!isRecord(location) || typeof location.id !== "string") continue;
    if (typeof location.defaultCalendarId === "string") {
      mappings.set(`location:${location.id}`, location.defaultCalendarId);
    }
    if (!Array.isArray(location.professionals)) continue;
    for (const professional of location.professionals) {
      if (!isRecord(professional) || typeof professional.professionalId !== "string"
        || typeof professional.calendarId !== "string") continue;
      mappings.set(`professional:${location.id}:${professional.professionalId}`, professional.calendarId);
    }
  }
  return mappings;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
