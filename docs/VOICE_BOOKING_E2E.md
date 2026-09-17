# E2E-001 — integrated voice booking

## Automated coverage

`tests/e2e/voice-google-booking.test.ts` exercises two complete booking scenarios
through the Asterisk telephony/media gateways, call orchestrator, current agent
configuration, conversation service, tool policies/confirmation gate, business and
appointment services, calendar assignment resolver and Google Calendar adapter.

The called DID selects either Central Clinic (Chicago, $95, location calendar) or
West Clinic (Denver, $125, professional calendar overriding the location default).
Both locations coexist in each scenario, with the same service and professional IDs.

Each scenario verifies:

1. The DID selects the expected location and phone agent context.
2. Real local UDP PCMU audio reaches the runtime as PCM16 mono at 24 kHz.
3. Public catalog information returns the location's price and service duration.
4. Google free/busy queries use the correct calendar and location timezone; the
   requested 10:30 AM local slot is validated.
5. Contact name/phone are saved for the call's customer.
6. Booking requires the configured confirmation token and a new caller turn.
7. While the Google create response is held, the appointment remains pending and
   no booking success result reaches the runtime.
8. Google success produces one confirmed appointment, with the correct location,
   professional, customer, historical price, UTC instant and original event ID.
   The Google payload carries the matching local time, timezone and 30-minute duration.
9. Duplicate delivery of the same tool call creates no extra event or tool result.
10. Assistant audio reaches the RTP peer, and caller hangup closes the runtime and
    cleans up the bridge/external-media channel once.

No production implementation changed. Tests use synthetic patient details only.

## Validation

On 2026-09-17: 68 focused tests passed across nine files, including all current E2E
scenarios, conversation service, Realtime adapter/payload/startup, Google adapter
and calendar assignment resolver. Backend typecheck, dashboard typecheck and
production build passed. No full-suite rerun was needed for test/documentation-only
changes; the prior SEC-001 full run was 428 passed and one optional live test skipped.

## What this does not prove

ARI events and Google HTTP responses are controlled doubles. The runtime is scripted;
it does not call OpenAI, recognize speech, synthesize speech or independently choose
wording. The RTP frames verify transport/conversion, not intelligibility. These tests
therefore do not establish live carrier connectivity, OAuth validity, natural spoken
confirmation, live model behavior, or autonomous goodbye/hangup. Operational/failure
scenarios remain E2E-002. No live Google event was created by this task.

## One real-call acceptance check

With the integration build running in an approved test environment and a test calendar:

1. Dial a configured location's number. Ask for a consultation price and an available
   appointment at a specific local time.
2. Give clearly synthetic contact details and agree to the offered appointment.
3. Listen for one clear confirmation only after booking succeeds, using the same
   local date/time. There should be no repeated request to confirm an already booked slot.
4. Check that exactly one event exists in the expected location/professional calendar,
   with the correct time, duration and test contact. Check the appointment is confirmed.
5. Hang up and verify the call/session, bridge and external-media resources close.

This manual check remains outstanding and must use test data/calendar resources.
