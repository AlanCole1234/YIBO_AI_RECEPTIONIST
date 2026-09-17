# Catalog administration — UI-006

Tenant administrators open **Services & professionals** in the dashboard.
The page follows the location editor's form, save, validation and conflict pattern.

## Supported controls

- Create and edit tenant-wide services: name, description, appointment duration,
  buffer minutes and active state.
- Select a location to add or edit its service offerings, active state, price and
  currency. Prices are informational. Decimal input is converted exactly to integer
  minor units using the currency's precision; no payment processing is introduced.
- Create and edit professionals/providers: display name and active state.
- Assign a professional to each location, choose which of that location's services
  they can perform, and enable/disable the assignment.
- Edit weekly professional availability with multiple day/time ranges. Times use
  the location's time zone. Empty hours inherit location hours; custom hours are
  intersected with location hours and closures by the existing scheduling domain.

The existing model has no separate provider leave/exception calendar. Location
closures and booking policies remain in Settings → Locations. No new scheduling
model or duplicate validation system was introduced.

## Existing protections

Catalog and professional writes use the existing dedicated admin APIs and their
reference protections. Location service offerings/prices use the existing versioned
business-configuration API, changing only the selected offering. Every mutation
sends the loaded version in `If-Match`. Tenant identity comes from authentication;
the UI supplies no tenant selector. Backend validation and audit logging remain
authoritative. Operator navigation excludes this page and backend writes deny
operators independently.

Failed saves retain the form. Version conflicts block subsequent writes until the
administrator explicitly discards the draft and reloads. Successful saves advance
the version, refresh business information and clear stale availability selections.
Only one form is edited at a time; location selection is locked during an edit.
Broader navigation/unsaved-change warnings remain UI-009.

Assigned catalog records can be protected from global deactivation even when an
assignment is inactive. Use location offering/assignment activation controls to
stop future availability; existing appointment references can prevent disabling a
professional assignment or removing its services. The location's default service
must remain offered. These are existing backend restrictions, not UI overrides.
This page uses activation controls rather than destructive deletion.

Existing appointments retain their stored service/price snapshots. Calendar IDs
are preserved, including professional overrides. Calendar mapping administration
remains UI-007 and was not started. No backend, database, Realtime or telephony
implementation changed.

## Validation (2026-09-16)

Continued the five existing unfinished UI-006 files without replacing their work.
Added regressions for stale price edits preserving newer routing and for disabling
and restoring unused provider assignments.

69 tests passed across eight files: catalog editor (25), location editor,
admin session, service API, professional API, business catalog service,
appointment service and scheduling service. Editor tests exercise the real
authenticated API with an injected HTTP transport. Coverage includes exact money,
versions/conflicts, role rejection, trusted tenant selectors, location isolation,
service eligibility, hours, activation, reference protections and retained routing.

Backend `tsc --noEmit`, dashboard `vue-tsc --noEmit -p dashboard/tsconfig.json`,
and `vite build --config dashboard/vite.config.ts` passed. Installed executables
were used directly, equivalent to package scripts, because the pnpm launcher has
previously stalled on this machine. No full-suite rerun was needed for this UI-only
change using existing backend contracts.

Manual browser interaction and live provider calls were not exercised. Recommended
smoke test: sign in as an administrator, create a service/provider, assign them at
one location with a price and hours, save/reload, and confirm another location is
unchanged. Open two tabs and verify a stale save retains the draft and requires a
reload. Verify an operator cannot access the page. No real customer data is needed.
