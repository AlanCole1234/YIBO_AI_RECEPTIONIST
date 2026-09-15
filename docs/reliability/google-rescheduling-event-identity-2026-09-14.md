# Google rescheduling event identity — September 14, 2026

## ROOT CAUSE

The appointment service rescheduled by inserting a replacement event using the same appointment ID, then deleting the original event. The Google adapter generated its insert ID with `a` followed by the appointment ID after removing every non-hexadecimal character. Changing the appointment time or idempotency key did not change that Google ID.

Google rejects an insert whose event ID already exists with HTTP 409. The adapter treated every 409 as successful creation without retrieving the existing event. The service therefore mistook the original event for a new replacement and deleted it.

The ID conversion was also lossy: different appointment IDs could become the same Google ID. It omitted tenant identity. Similar dates, times, or names were not themselves the cause; identity handling was.

## EXACT FAILURE SCENARIO

Two regressions were written and run against the original code before the fix. Both failed:

1. Book August 24, 2026 at 9:00 AM America/Denver, then reschedule to August 25 at 10:30 AM. The replacement POST reuses the original event ID and receives 409. The service reports success and saves the new local time, but its subsequent DELETE removes the original event. The test expected one active remote event and found zero.
2. Book `appointment-gg12345` at 9:00 AM and `appointment-hh12345` at 9:30 AM. Both old IDs become `aae12345`. The second POST receives 409; both local appointments are recorded against the first appointment's event. The test expected distinct event IDs and found the same ID.

A separate assertion-based reproduction executed the saved original adapter and service and canceled the second appointment. It verified this result:

```json
{"baseline":"verified","sharedEventId":"aae12345","requestedCancellation":"appointment-hh12345","actualDeletedEventOwner":"appointment-gg12345","requests":["POST","POST","DELETE"],"remainingEvents":0}
```

**Impact:** wrong-event deletion was reproduced. The ordinary reschedule could also delete its own original event while claiming success locally. The reproduced collision did not update a remote event or create a duplicate: the 409 insert did neither. It created incorrect local associations and then enabled destructive deletion. Merely switching to PATCH without checking ownership would leave those incorrect associations dangerous.

## FIX

- Reschedule by PATCHing only start/end on the appointment's persisted Google event ID. Keep that exact ID in the appointment. There is no replacement insert or old-event deletion during rescheduling.
- Before PATCH or DELETE, retrieve the event and verify its ID, active status, appointment marker, and tenant marker when present. Reject mismatches before mutation.
- Use the retrieved ETag with `If-Match` so a concurrent external edit causes a conflict instead of silently modifying a changed event.
- Generate IDs for new bookings from SHA-256 of the full, unambiguous `[tenantId, appointmentId]` tuple. Add both identity markers to new events. Dates and times are not part of identity.
- Accept insert 409 as a retry only after retrieving and verifying the existing event's identity, active status, and exact start/end instants.
- Preserve legacy stored IDs and matching legacy appointment markers. Do not migrate or recreate existing events.
- Re-read appointments inside the existing concurrency guard; serialize cancellation with rescheduling. A repeated request for the already-saved start time returns the existing appointment without another write.
- Implement the same in-place reschedule contract in the SQLite and in-memory calendar adapters. Availability rules, appointment duration, clinic timezone handling, conversation, Realtime, and telephony implementations were not changed by this fix.

Google documents [409 duplicate identifiers and 412 conflicts](https://developers.google.com/workspace/calendar/api/guides/errors), [PATCH semantics](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch), and [conditional modifications using ETags](https://developers.google.com/workspace/calendar/api/guides/version-resources).

## REGRESSION TESTS

`tests/integrations/google-rescheduling-regression.test.ts` adds 25 tests using the real appointment service, Google adapter, and scheduling service with a stateful HTTP calendar double. The double models duplicate-ID 409 responses, event storage, busy intervals, PATCH, deletion, and conditional-write conflicts.

Coverage includes:

- Both original failures above.
- Correct selection among four appointments with similar names and adjacent times across two dates; all other events and local appointments remain unchanged.
- Repeated reschedules, identical-request retries, dates across daylight saving changes, return to the original time, and cancel after reschedule.
- Original persisted event ID retained after every move; unchanged event counts; no replacement insert or reschedule DELETE.
- Legacy event IDs and preservation of notes, attendees, reminders, and location.
- Incorrect stored references and tenant markers rejected before updating or deleting an unrelated event.
- Concurrent external edits, missing/deleted events, and seven provider-error statuses.
- Occupied destinations still rejected; concurrent repeated moves produce one PATCH; cancellation cannot be undone by a queued reschedule.
- Safe duplicate-insert retries and rejection of 409 responses with mismatched appointment, tenant, time, or canceled status.
- Same appointment identifier in different tenants produces different valid Google IDs.

Existing appointment-service expectations now require the original ID after rescheduling. Existing cancellation fixtures pass appointment identity under the strengthened calendar contract.

## FULL TEST COUNT

**548 passed, 1 optional live Realtime test skipped (549 total).** Test files: 37 passed, 1 skipped. The prior completed conversation-flow baseline was 523 passed and 1 skipped; this fix adds 25 tests.

Passed commands, using the installed executables corresponding to package scripts:

```sh
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vue-tsc --noEmit -p dashboard/tsconfig.json
./node_modules/.bin/vite build --config dashboard/vite.config.ts
git diff --check
```

The full suite ran with localhost UDP binding available for the existing RTP tests. It includes scheduling, booking confirmation, cancellation, rescheduling, conversation lifecycle, Realtime protocol, and telephony regressions. Production Vite build completed successfully.

## ANY REMAINING RISKS

- Tests use a stateful Google HTTP double; no live Google Calendar writes or live phone calls were performed. The optional live Realtime test remains skipped.
- Historical wrong references or already-deleted events are rejected, not automatically repaired. Existing affected records may require reconciliation.
- A successful remote update followed by a lost response or failed local database save can leave an uncertain or inconsistent outcome. Google and the local database do not share a transaction; this change does not add cross-system reconciliation.
- The existing in-process concurrency guard and Google ETags protect the tested races. They do not make availability checks and writes atomic across multiple processes or external calendar users.

No commit, push, merge, or deployment was performed. Earlier uncommitted conversation and voice changes were preserved.
