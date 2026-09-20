import type { BusinessConfigurationV2 } from "./multi-location-business.js";

export interface CalendarRouteReference { locationId: string; employeeId: string }

/** Compare effective IDs, not override/fallback source. No provider calls or event migration. */
export function changesBookedCalendarRoute(
  before: BusinessConfigurationV2,
  after: BusinessConfigurationV2,
  references: readonly CalendarRouteReference[],
): boolean {
  const calendar = (profile: BusinessConfigurationV2, reference: CalendarRouteReference) => {
    const location = profile.locations.find(({ id }) => id === reference.locationId);
    const professional = location?.professionals.find(({ professionalId }) => professionalId === reference.employeeId);
    return professional ? professional.calendarId?.trim() || location?.defaultCalendarId?.trim() || undefined : undefined;
  };
  return references.some(reference => calendar(before, reference) !== calendar(after, reference));
}
