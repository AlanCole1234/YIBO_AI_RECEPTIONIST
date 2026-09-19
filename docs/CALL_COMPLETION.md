# CLOSE-001 — intentional call completion

## Behavior

Phone conversations with tools enabled, serial tool calls and a playback-idle-capable
transport now receive an `end_call` session capability. It is not an appointment
mutation or a persisted/admin tool. Voice Lab and transports without playback signals
are unchanged; the validated Realtime payload rejects this capability on other channels.
See [ADR-008](adr/ADR-008-intentional-call-completion.md).

YIBO is instructed to finish the requested work, report its actual outcome, speak a
brief final farewell and then request end_call in the same response. The backend
requires an empty argument object and current-response audio. Pending tool work or
an uncertain mutation blocks the request. A known booking failure can be explained
and followed by a farewell; end-call success does not mean booking success.

The accepted function result is sent without requesting another Realtime response.
The session waits for all of: result acknowledgment, successful response completion,
matching audio completion and playback idle. A final partial RTP packet is padded
with PCMU silence, then sent before closure. A 20 ms packet tail follows local drain.
A 45-second final-completion deadline fails/cleans up rather than hanging forever.

Caller speech, text or interruption cancels pending hangup. Another business tool or
new response also invalidates the old ending. Ordinary response completion does not
hang up. Duplicate tool deliveries are ignored; repeated end requests do not schedule
extra speech. Unsolicited responses while ending are cancelled; caller speech resumes
normal response behavior. Calls handles the final ARI hangup and resource cleanup.

## Verification — 2026-09-19

- 22 new tests cover lifecycle ordering, packet-tail delay, ordinary conversation,
  unsupported sessions, hostile arguments, repeated requests, caller interruption,
  pending/uncertain bookings, known failures, slow acknowledgment, cancelled response,
  deadline, caller hangup, and no extra Realtime response after end acknowledgment.
- Both location scenarios in the integrated Google-booking test now end intentionally
  after a partial final RTP packet, verifying COMPLETED state and resource cleanup.
- Full suite: 465 passed, one optional live test skipped. Both typechecks and production
  build passed. Google routing, reschedule/cancel and existing phone tests remain green.

## Real-call acceptance still required

No real OpenAI/Google/carrier call was made. The model must follow the farewell/tool
instruction; a local UDP drain plus packet-tail delay cannot prove remote acoustic
playback. Provider/buffering behavior must be checked in the intended test deployment.

Use synthetic contact details and a test calendar. Book a time, listen for the actual
confirmation, then say “That is all, thank you.” YIBO should finish the farewell and
hang up once, with no second question. In a separate call, interrupt the farewell
with another request; the conversation should continue. Check the final event/time,
call state and ARI bridge/External Media cleanup. Do not deploy/restart the working
phone service merely to perform the automated checks.

CLOSE-002 (existing-booking routing changes) remains open. This change does not close
REL-002 or constitute production acceptance.
