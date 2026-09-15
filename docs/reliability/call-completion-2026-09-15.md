# Call completion — September 15, 2026

## Reproduced causes

1. A spoken goodbye was only another Realtime response. No end-call action existed. `response.done` returned the runtime to listening, leaving its completion promise and the Asterisk caller channel open. Three initial end-call regressions failed before the fix.
2. Asterisk `CHANNEL_DESTROYED` awaited media cleanup before notifying the call orchestrator. Cleanup awaits ARI external-channel and bridge deletion; ARI HTTP requests had no deadline. A pending deletion therefore prevented the hangup notification from reaching Realtime. A regression verified the missing notification while cleanup remained pending.

These are demonstrated implementation defects, not a claim to have captured the user's failed live phone call. A new live phone trace was not available during this task.

## Call path traced

1. ARI `StasisStart` identifies the caller; the telephony gateway prepares the mixing bridge, external-media channel, and RTP transport.
2. The call orchestrator answers, resolves the customer and agent, opens the media transport and Realtime session, then starts the greeting.
3. Realtime emits tool calls. The conversation service executes them and returns correlated results with existing deadlines and deduplication.
4. `confirm_appointment` records consent only. `create_appointment` waits for Calendar success, saves the confirmed appointment and actual event identity, and returns the clinic-local display time. Failure remains failure. This path was not changed.
5. The booking-result response announces success or explains failure. Normal waiting for the caller remains unchanged.
6. On the caller's clear request to finish, the new internal `end_call` function schedules one tools-disabled goodbye. It waits for both generation completion and the existing transport playback-drained callback. It does not close at `response.done` while audio remains queued.
7. Runtime closure settles the conversation completion promise. The existing orchestrator closes the transport, records completion, and hangs up the caller channel. The transport stops RTP, closes its socket, removes the external channel/bridge, and releases its port.
8. If the caller hangs up first, hangup notification and media cleanup now start independently. ARI requests abort after four seconds, including response-body reads. The existing conversation/tool deadlines are retained.

The tests exercise these layers using simulated Realtime/ARI events; RTP resource tests bind real localhost UDP sockets. The previous investigation verified a live Google create/update/delete cycle; it was not repeated in this call-completion task.

## Narrow changes

- `openai-realtime-adapter.ts`: advertise and handle internal `end_call`; require pending tools to finish; request one final goodbye; close after final playback; permit caller interruption to cancel the pending finish. No new booking tool or Calendar behavior.
- `asterisk-telephony-gateway.ts`: emit caller hangup independently of media cleanup.
- `asterisk-ari-client.ts`: four-second abort signal on ARI HTTP requests.
- Three test files: new `call-completion.test.ts`, targeted additions to the telephony gateway and ARI client tests.

## Validation

Final targeted selection: **28 passed**. Across all runs: **35 executed cases**, including four intentionally failing pre-fix reproductions and three early passing reruns. Filtered-out tests did not execute. No full suite.

Coverage: normal explicit completion in text/audio modes; booking consent followed by successful or failed Calendar result; no completion during a pending tool; no duplicate final response; tools disabled for the goodbye; early caller hangup; interruption of goodbye; runtime completion leading to telephony hangup; startup hangup; tool timeout and late results; pending cleanup notification; ARI abort; bridge/external-channel deletion; UDP port release and reuse.

Backend TypeScript and diff whitespace checks passed. No commit, push, merge, deployment, or server restart was performed.

## One real phone check

Restart the local YIBO process that handles Asterisk so it loads the change. Call normally, book a test appointment, and hear the date/time confirmation. Say “No, that is all. Goodbye.” The call should give one brief goodbye, play it completely, then disconnect without another question.

Check that the appointment exists once. For the same call ID, inspect `telephony.call.end_requested`, `telephony.call.final_response_drained`, `telephony.media.cleanup`, and `telephony.asterisk.call_ended`. Confirm no test bridge/external-media channel remains in Asterisk.

A provider outage may prevent remote cleanup from succeeding even though the deadline releases local waiting. The fix does not guarantee remote deletion during an ARI outage. Live recognition of a caller's wish to end still needs the phone check above.

Protocol reference: [OpenAI Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations). A completed model response and a completed telephone playback are separate events.
