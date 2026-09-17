import { reactive } from "vue";
import { api, ApiError, type VerifiedCalendarSnapshot } from "./api.js";

export function calendarStatusLabel(status: unknown): string {
  switch (status) {
    case "accessible": return "Access verified";
    case "unconfigured": return "No calendar configured";
    case "integration_not_configured": return "Google integration not configured";
    case "disconnected": return "Google connection required";
    case "forbidden": return "Calendar access denied";
    case "not_found": return "Calendar not found";
    case "unavailable": return "Verification unavailable; try again";
    default: return "Not checked; verify saved mappings";
  }
}

export function createCalendarEditor(client = api) {
  const state = reactive({
    locations: [] as Array<{ id: string; name: string; active: boolean }>,
    snapshot: undefined as VerifiedCalendarSnapshot | undefined,
    draft: undefined as { professionalId?: string; calendarId: string } | undefined,
    busy: false, conflict: false, error: "", saved: false,
  });
  async function load(locationId?: string) {
    if (state.busy) return false;
    state.busy = true; state.error = "";
    try {
      const document = await client.businessConfiguration();
      const locations = document.configuration.locations.map(({ id, name, active }) => ({ id, name, active }));
      const selected = locationId ?? state.snapshot?.locationId ?? locations[0]?.id;
      const snapshot = selected ? await client.locationCalendars(selected) : undefined;
      state.locations = locations; state.snapshot = snapshot;
      state.draft = undefined; state.conflict = false; state.saved = false;
      return true;
    } catch { state.error = "Unable to load or verify calendar mappings. Check your access and try again."; return false; }
    finally { state.busy = false; }
  }
  function edit(professionalId?: string) {
    if (!state.snapshot || state.busy || state.conflict || state.draft) return;
    const professional = state.snapshot.professionals.find(item => item.professionalId === professionalId);
    if (professionalId && !professional) return;
    state.draft = { ...(professionalId ? { professionalId } : {}), calendarId: professionalId ? professional?.calendarId ?? "" : state.snapshot.defaultCalendarId ?? "" };
    state.saved = false; state.error = "";
  }
  async function save() {
    if (!state.snapshot || !state.draft || state.busy || state.conflict) return false;
    state.busy = true; state.error = ""; state.saved = false;
    const { locationId, version } = state.snapshot;
    const { professionalId, calendarId } = state.draft;
    try {
      // Mutation responses contain routing, but no verification statuses. Never retain stale statuses.
      state.snapshot = professionalId
        ? await client.updateProfessionalCalendar(locationId, professionalId, calendarId.trim() || null, version)
        : await client.updateLocationCalendar(locationId, calendarId.trim() || null, version);
      state.draft = undefined; state.saved = true;
      return true;
    } catch (error) {
      state.conflict = error instanceof ApiError && error.code === "CONFIGURATION_VERSION_CONFLICT";
      state.error = state.conflict
        ? "Mappings changed elsewhere. Your draft is retained. Copy any edits you need, then discard the draft and reload."
        : error instanceof ApiError && error.code === "CALENDAR_ACCESS_NOT_VERIFIED"
          ? "Not saved: Google calendar access could not be verified. Check the calendar ID, connection and permissions, then try again."
          : "Mapping was not saved. Check your administrator access and calendar ID, then try again.";
      return false;
    } finally { state.busy = false; }
  }
  return { state, load, edit, save };
}
