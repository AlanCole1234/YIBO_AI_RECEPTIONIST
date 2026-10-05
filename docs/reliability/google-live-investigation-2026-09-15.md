# Google Calendar live investigation — September 15, 2026

## Status

The reported manual-call failure has **not yet been reproduced or explained**. No production source changes were made during this investigation. The event-identity and conversation reliability fixes remain intact.

## Actual runtime and live results

- API on localhost:3000 and development voice server on localhost:4317 were running. Both entry points use `buildConfiguredApplication`.
- The API's Google status endpoint returned configured/connected after a real FreeBusy request.
- A diagnostic process loaded the workspace `.env` and the normal configured application, using the configured tenant, stored business profile, encrypted OAuth token store, actual Google adapter, scheduling service, appointment service, and tool executor. It did not start a phone or Realtime session.
- The only outgoing event-content modification was a summary of `[YIBO TEST] Calendar Regression Check`. A synthetic test customer was held in the diagnostic process's normal in-memory customer repository.
- Availability returned HTTP 200. `check_availability` and `confirm_appointment` succeeded. The latter records consent, not completed booking.
- `create_appointment` made an actual Google insert: HTTP 200, followed by GET 200 verifying the event and booked time. The tool returned a CONFIRMED local appointment, its actual external event ID, and clinic-local appointmentDisplay.
- `reschedule_appointment` used ownership GET 200 and conditional PATCH 200. Another GET verified the same ID and changed time.
- `cancel_appointment` used ownership GET 200 and conditional DELETE 204. GET afterward verified canceled status. No active temporary event remained.
- Only one event was inserted. No unrelated real appointments were modified.

Test event ID: `ae646f33129e79e82a8e7859e8befad15247b6bd77f6b5fec3667abd668d590c8`.

Diagnostic evidence is in `/tmp/yibo-calendar-live-current.log`; the temporary diagnostic script is `/tmp/yibo-calendar-live.mts`. These are local temporary files, not production code or a supported reusable test command.

## Investigation limits and next evidence needed

The recent appointment port/service, Google adapter, SQLite adapter, and both in-memory adapter changes were reviewed. Google accepted the new ID, stored ownership markers, and ETag-based PATCH/DELETE against the actual configured calendar. This rules out those operations being universally rejected; it does not rule out a failure specific to the user's call, slot, token state at that time, or tool sequence.

The API and voice servers' stdout/stderr are pipes, not readable log files, and no app terminal is attached to this task. Their historical call output could not be retrieved here. No microphone/phone conversation was reproduced.

The configured application uses in-memory appointment and customer repositories, despite storing configuration/tokens in SQLite. Consequently, restarts lose local appointment references while Google events persist. This predates the targeted event-ID fix and was not changed. It can affect later appointment lookup but is not evidence of the reported new-booking failure.

Needed to continue: browser voice versus phone line, what YIBO said/did, approximate failed-call time, and any tool/Calendar error output. A source-code fix without that evidence would be speculative.

## Tests run

- 50 passed: Google adapter, Google rescheduling identity regressions, and appointment service.
- 8 passed: selected confirmation success/failure, missing-consent, and duplicate-confirmation tool tests. The other 101 cases in that file were filtered out and did not run.
- One live Calendar lifecycle scenario passed as described above.

**Total: 58 automated test cases plus 1 live scenario = 59; no failures.** The full suite was not run. Typecheck/build were not repeated because production source was unchanged.

No commit, push, merge, deployment, or restart was performed. Only this report was added to the workspace by this investigation; the live diagnostic used the normal bootstrap/token store, which may persist normal configuration/token housekeeping.
