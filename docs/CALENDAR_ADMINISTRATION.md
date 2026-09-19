# Calendar administration — UI-007

Tenant administrators open **Calendar mappings** and select a location. The page
shows its default calendar and each assigned professional's override, effective
calendar, and source (professional override, location fallback, or unconfigured).
It reuses the existing calendar-assignment APIs and resolver; no routing model,
backend logic, persistence, telephony or Realtime behavior was changed.

## Editing and verification

- Edit the location default or one professional override at a time. Blank input
  explicitly removes the mapping. Removing an override restores the location
  fallback; removing the default leaves professionals without overrides unconfigured.
- The existing backend verifies nonempty IDs before saving. Every mutation sends
  the loaded shared configuration version in `If-Match` and records existing audit
  metadata. Tenant identity and admin authorization remain server-controlled.
- Failed saves retain the draft. Conflicts block further writes until the admin
  explicitly discards the draft and reloads. Navigation-wide unsaved warnings are provided by UI-009; see `OPTIMISTIC_EDITING.md`.
- **Verify saved mappings** performs existing read-only access checks. It displays
  only fixed labels for accessible, unconfigured, disconnected, forbidden, missing,
  unavailable, or unconfigured integration states. Provider errors and OAuth
  credentials are never rendered. Calendar IDs are shown to authorized admins.
- Mutation responses do not contain verification statuses. After saving, the UI
  clears old status labels and asks the admin to verify again, avoiding stale
  success claims. Verification is a point-in-time calendar access check, not a
  booking or proof of write permission; it creates no test events.
- Saving refreshes dashboard business information and clears stale slot selections.
  Editing does not modify service eligibility, professional hours, other locations,
  or appointment data.

## Existing appointments and manual checks

Changing a mapping does not migrate Google events. The existing resolver uses
current routing; changing a route with existing bookings can affect later
rescheduling/cancellation of those bookings. The page warns admins to review
existing bookings first. Handling routing changes for existing appointments remains open as CLOSE-002;
see [release audit](RELEASE_CLOSURE_AUDIT.md). E2E-002 tested unchanged mappings,
so neither task establishes safe migration of an existing booking to a new route.

Use a test location without existing bookings for the manual browser smoke test:
set a default, set a provider override, verify both, clear the override and confirm
fallback, and check another location remains unchanged. Use an inaccessible ID to
confirm a failed save retains the draft. Use two tabs to verify conflict handling.
Check operator navigation/access is denied. Verify with real Google credentials
that the displayed access status matches the configured calendar; no live-provider
or interactive browser testing was performed during implementation.

## Validation — 2026-09-17

71 tests passed across six files:

- Calendar editor: 18 tests, including real authenticated API integration, routing
  precedence, removal/fallback, version conflicts, location isolation, access
  rejection, safe labels, failed reloads and preserved drafts.
- Existing calendar-assignment API, business calendar resolver, Google event
  identity, appointment service, and UI-006 catalog editor regressions.

Both backend and dashboard typechecks and the production Vite build passed using
installed package executables (equivalent to the package scripts). The full suite
was not rerun: changes are confined to the dashboard, and the focused set includes
existing routing and booking/reschedule/cancel regressions. No live events changed.
UI-008 was not started.
