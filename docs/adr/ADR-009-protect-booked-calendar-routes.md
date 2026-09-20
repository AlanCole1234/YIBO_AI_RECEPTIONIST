# ADR-009 — protect calendar routes used by existing bookings

- Status: Accepted
- Date: 2026-09-20
- Scope: Business configuration persistence; complements ADR-005

## Decision

Use a guarded mapping-change policy. Do not migrate Google events or infer historical
routes. Reject a configuration save with `CALENDAR_ROUTE_IN_USE` if it changes the
effective calendar ID for any location/professional with a non-cancelled appointment.
Compare professional override with location fallback; changing the source while
retaining the same effective calendar is safe. Unrelated routes remain editable.

Pending bookings reserve the route before Google creation. Failed bookings also
reserve it because an unsuccessful provider response does not prove no event exists.
Confirmed past bookings remain protected. Cancellation releases the reservation only
after the existing calendar operation succeeds and the cancelled row is saved.
Historical rows without route snapshots receive exactly the same protection.

Enforce the comparison in configuration persistence, including full-document and
unversioned saves. SQLite reads references and writes configuration inside the same
BEGIN IMMEDIATE transaction. In-memory storage performs the reference read and save
synchronously with no await between them. The local reference-read contract is
synchronous specifically to preserve this atomicity; a future remote store must
supply equivalent transactional protection, not a check-then-write network call.

Version conflicts retain precedence. No schema/provider/tool changes are necessary.
Existing ownership/etag checks, booking validation and event IDs are unchanged.

## Limits and operations

This prevents future mapping changes from stranding bookings. It cannot discover or
repair mappings changed before deployment. Do not delete appointment rows to bypass
the guard. Staff must reconcile uncertain/failed bookings with the provider before
any separately reviewed recovery; no automatic retry, migration or new recovery API
is introduced. Bulk moves with active bookings require a future explicit migration
workflow. The UI explains blocked saves and retains the draft.
