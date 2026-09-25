# E2E-002 — operational and failure scenarios

> REL-002 audit correction (2026-09-19): these 13 scenarios passed, but the earlier
> integration inventory also assigned final playback/end-call and changed calendar
> mappings to this task. CLOSE-001 is now implemented (see CALL_COMPLETION.md);
> CLOSE-002 is now implemented with guarded mappings (see BOOKED_CALENDAR_ROUTES.md).
> E2E-002 is complete for automated coverage; live acceptance remains separate.
> See [release audit](RELEASE_CLOSURE_AUDIT.md).

Verified 2026-09-19 on the integration branch. Production implementation is unchanged.

## Coverage

`tests/e2e/phone-operations.test.ts` adds 13 scenarios using the real application,
Asterisk telephony/media gateways, conversation service, current agent tools,
scheduling/appointment services, calendar resolver and Google Calendar adapter.
ARI, Realtime and Google HTTP boundaries are synthetic; media allocates real local
UDP sockets. Fixtures contain synthetic contacts only.

- List only the active caller's appointment among two customers' existing events.
- Reschedule the selected appointment twice, keeping the original Google event ID
  and the neighboring event unchanged; cancel that same event without extra creates.
- Handle calendar availability outage, keep other conversation tools usable, and
  resume booking after provider recovery.
- Reject booking success when Google's create request fails.
- Preserve the original event and public appointment time when Google rejects a
  reschedule or cancellation.
- Two callers see the same available slot, then compete to book it while one Google
  create is held pending: one succeeds, one receives SLOT_NO_LONGER_AVAILABLE, and
  only one event exists. This exercises the current single-application booking guard.
- Transfer uses the location's configured extension. A PBX failure restores the
  conversation state; successful transfer remains TRANSFERRED after hangup.
- Failures during answer, external-media creation or runtime startup clean up the
  allocated bridge and allow a subsequent call to proceed.
- A missing RTP peer triggers the existing four-second output deadline, closes the
  runtime, hangs up the caller and destroys the bridge.
- Runtime failure followed by repeated PBX hangup closes the runtime and destroys
  the bridge once, retaining the FAILED state.

## Validation

57 tests passed across nine focused files: all E2E scenarios, conversation service,
Google event identity, transfer adapter, Asterisk gateway and RTP gateway. Backend
and dashboard typechecks and production build passed. No full-suite rerun was
necessary for test/documentation-only changes.

## Limits and manual acceptance

These tests do not make real phone calls, authenticate to Google/OpenAI, evaluate
spoken wording or prove PBX transfer destination reachability. The concurrency test
covers two sessions in one application instance, not separate processes or competing
external calendar writers. Natural goodbye/end-call behavior is not established by
scripted runtime completion or caller hangup.

In a test deployment, use synthetic contacts and a test calendar to check listing,
rescheduling and cancellation among multiple events, successful staff transfer,
and one controlled calendar or media outage. Confirm truthful spoken outcomes and
that each call's ARI bridge/external-media resources close. Live checks remain
outstanding. Do not induce outages on the working production phone service.

Next roadmap task: DOC-003 (final documentation and runbooks); not started here.
