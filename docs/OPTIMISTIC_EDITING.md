# Optimistic editing and unsaved changes — UI-009

## Leaving an editor

Agent settings, location settings, open catalog/calendar forms and pending
appointment confirmations register with the dashboard's leave guard. Section
navigation, explicit logout and Google-connect navigation ask before discarding
unsaved work. While a registered editor or dashboard request is busy, leaving is
blocked until it finishes. Tab close/reload uses the browser's native unload
warning; browsers control its wording and may suppress it without user interaction.

Location and agent editors compare the draft with their last accepted snapshot;
successful saves/reloads reset that baseline. Opening catalog/calendar edit forms
is conservatively considered unsaved until saved or explicitly discarded. Changing
locations in the location editor retains all locations in the same draft. Catalog
and calendar location selection stays locked during an edit.

Conflicts retain the draft, block repeated saves and offer an explicit
**Discard draft and reload** action. Copy desired edits before reloading and reapply
them against the new server state. There is no automatic merge, retry or force-save.
Restoring recommended agent settings asks before replacing existing unsaved edits.
Fields are disabled during an agent save so its response cannot erase newer typing.

Security-driven session expiry still ends access immediately; it is not blocked by
an unsaved-change prompt. Drafts are not persisted to browser storage. Existing
customer-entry/search fields retained by the app are not configuration editors.

## Conditional agent saves

Business/location/catalog/calendar editors keep their existing numeric configuration
versions and `If-Match` behavior. Agent settings previously had only a schema version,
which describes the data format rather than changes made by another administrator.

The agent configuration read response now includes an opaque content `revision`.
The dashboard sends that value, quoted, in `If-Match` on `PUT /api/configuration`.
The save response includes the next revision. Missing headers return 428; malformed
headers return 400; stale or competing writes return 409
`CONFIGURATION_VERSION_CONFLICT`. Older custom API clients must fetch a revision
before saving. The schema version and Realtime configuration payload are unchanged.

The application validates settings and checks the revision, then uses an atomic
repository compare-and-save. SQLite conditionally updates the existing JSON (or
inserts only when absent), scoped by region and tenant. The in-memory repository
has matching behavior. No database schema migration is needed. Trusted internal
configuration initialization still supports its existing unconditional save path;
all administrator HTTP writes require the conditional header. Successful writes
retain existing redacted auditing; rejected writes do not create success audits.

Appointment operations retain their existing domain policy/state/slot checks and
have no new record-version API. UI-009 protects their pending UI confirmation from
navigation loss; it does not add appointment-level transaction/concurrency semantics.
Calendar routing and ambiguous external-operation risks documented in UI-007/008
remain owned by the operational roadmap.

## Checkpoint 7 validation — 2026-09-17

- 67 focused tests passed: leave guards, agent API/version races, SQLite conditional
  updates/inserts, and existing location/catalog/calendar conflict behavior.
- Full suite: **383 passed, 1 optional live test skipped**, 68 passing test files.
- Backend and dashboard typechecks and Vite production build passed using installed
  package executables equivalent to the package scripts.
- No active calls, provider defaults, calendar events or production data changed.

Manual browser checks remain: edit each settings page, try leaving/logging out,
choose Stay and verify the draft, then choose Discard. Test reload/close warnings,
successful save clearing the warning, and two tabs saving different agent settings.
The second tab must retain its draft on conflict and require explicit reload.
Interactive browser and live-provider testing were not performed during this task.
Checkpoint 7 is complete. OBS-001 is next and was not started.
