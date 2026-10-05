# Conversation lifecycle fixes — September 14, 2026

## Result and scope

The identified conversation stalls now have tested recovery or terminal cleanup paths. Normal listening has no timeout or automatic reprompt. The existing 650 ms server VAD silence window, 100 ms local grace period, sustained barge-in threshold, echo checks, model, scheduling rules, and Google Calendar implementation were retained. The prior successful-booking confirmation improvement remains intact.

Changes are limited to conversation lifecycle handling, call cleanup on runtime completion, browser playback completion notifications, and timing diagnostics. No Calendar, appointment-service, Asterisk, RTP encoding/pacing, or scheduling implementation was rewritten. Existing uncommitted work was preserved. Nothing was deployed.

## Root causes and fixes

| Root cause | Fix |
| --- | --- |
| Audio commit arriving before speech-stop was discarded; a late commit could be attributed to a different phrase. | Correlate commits and stops by user item ID. Keep early commits and ignore earlier phrases when evaluating the current turn. |
| Lost speech-stop or commit notifications could leave a completed answer waiting indefinitely. | Accept the matching committed audio item as end-of-turn evidence and the matching created/completed user audio item as commit evidence. Otherwise expire a missing commit explicitly. |
| Missing response acknowledgement/completion could leave response gates closed indefinitely; the old watchdog resent unacknowledged requests. | Apply a 15-second progress deadline to outstanding response requests and generation. Do not resend an ambiguous request. A late original response could otherwise execute tools twice. |
| A missing tool-arguments notification could strand a completed tool response. | Recover complete function arguments from the final response using the same call-ID deduplication. Exclude cancelled responses. |
| Explicit generation failures usually terminated immediately. | Permit one recovery response with tools disabled. A second failed recovery terminates explicitly. Existing booking recovery also waits for the original response to finish. |
| A text message arriving while another response/tool was active could be dropped as pending work. | Retain the pending text response and resume through the existing central response gate. |
| Tool results could request another response while earlier audio was still playing. | Make actual playback an independent gate, even when the state label changes to tool-running. Drain/interrupt notifications release it. |
| Browser playback never notified the runtime when its audio queue drained. | Send the newest audio sequence with the browser's drain acknowledgement; ignore stale acknowledgements when newer audio is in flight. |
| Interrupting audio after generation completed left the unheard tail in model history. | Truncate the unheard audio/history even when no active generation needs cancelling. |
| Tool promises had no conversational deadline. | Return a result after a 12-second timeout. Lookups may be retried; timed-out calendar mutations remain uncertain and block additional calendar mutations for that call. Do not deliver late results twice or automatically retry a mutation. |
| Usage recording and diagnostic exceptions could block or terminate the voice event loop. | Record usage asynchronously with handled errors; isolate diagnostic observer exceptions. |
| Audio writes or cleanup promises could remain pending indefinitely. | Bound audio writes and cleanup at five seconds; cancel outstanding local tool/write deadlines when closing. |
| A runtime stream ending without a closed event did not settle completion. | Settle and clean up on end-of-stream. Local close owns its own completion so a stream-end callback cannot hide a cleanup timeout. |
| A failed runtime was not connected to phone-call termination. | Observe session completion and clean up/hang up the associated call once. Caller-initiated hangup claims cleanup before closing the runtime. |
| Connection/configuration acknowledgement had no explicit application deadline. | Set a 15-second WebSocket handshake timeout, reject early socket close, and bound the greeting's configuration wait. |

The initial 12 fault-injection tests failed against the pre-change implementation and passed after the fixes. Later regression checks caught a cleanup ordering race, which was corrected before the final full-suite run.

## Listening, interruptions, and context

Idle caller-thinking silence does not create another question. A resumed phrase cancels the pending turn during the existing local grace period. A known active caller turn prevents a competing response. Already-committed phrase items remain in provider conversation history; there is no local history reset between turns. Unheard assistant audio is removed on interruption.

The prior booking instructions still require success before announcing confirmation, use the saved appointment's clinic-local display date/time, and prohibit repeating confirmation or requesting another yes after successful booking.

The simulation tests verify protocol behavior. They do not prove that a live model understands every correction, recognizes every utterance, or chooses the ideal wording.

## Latency findings

No silence timers were shortened. There is no measured live-call speedup claim.

- Configured end-of-speech silence: **650 ms**. This is a configuration value, not a measurement of the caller's final physical sound.
- Local grace after the VAD stop: **100 ms**, unchanged.
- Usage recording no longer delays subsequent voice events. A never-resolving usage recorder is explicitly tested while audio and interruption handling continue.
- Timing metadata is delivered before the first audio frame, so an immediately-playing sink can observe it.
- Added response-request-to-start timing. The previous classification compared total commit-to-response-start time against tool duration, incorrectly including local/tool waits in the apparent model-start delay.
- Existing first-audio-to-first-RTP telemetry remains available for live output-path timing. No new live RTP timing measurements were collected.

A deterministic timing test injects the following sequence:

| Stage | Injected/measured test interval |
| --- | ---: |
| VAD stop to commit | 0 ms |
| Local grace | 100 ms |
| First response acknowledgement | 40 ms |
| Model emits lookup request | 60 ms |
| Tool completion | 600 ms |
| Follow-up response acknowledgement | 40 ms |
| Follow-up response start to first audio | 80 ms |
| Total VAD stop to first audio | **920 ms** |

The classifier correctly identifies the **600 ms tool wait** as the largest injected bottleneck. These numbers are simulated, not production model or Google Calendar measurements. The actual largest live bottleneck still requires a real-call trace.

## Validation

Final full suite: **523 passed, 1 optional live Realtime test skipped**, across **36 passing files and 1 skipped file**. This adds **45 tests** over the 478-test baseline from the preceding confirmation change.

New coverage includes:

- Early/stale/missing commit and speech-stop events, missing response acknowledgement/completion, missing tool arguments, session configuration stalls, and playback completion stalls.
- Text, greeting, audio-turn, and tool-result response deadlines; one speech-only recovery; no duplicate unacknowledged requests.
- Safe lookup/mutation timeouts, replayed tool calls, late results, hangup during pending work, and blocked mutation retries after uncertain outcomes.
- Stalled accounting, observer exceptions, stalled audio writes/cleanup, unexpected stream completion, and once-only phone cleanup.
- Browser drain acknowledgement and stale completion after interruption.
- Timing attribution and timing-before-audio ordering.
- Fourteen six-turn protocol simulations covering immediate/one-second/several-second answers, filler/resumed phrases, corrections, long/one-word answers, affirmative answers, changing one's mind, requests to repeat, multiple pauses, and a 60-second thinking pause. Each returns to listening and checks one response per completed turn.

The full suite also includes the existing end-to-end call/appointment simulations, 50 scheduling changes, duplicate-booking protections, availability, appointment creation/confirmation, cancellation/rescheduling, timezone handling, Google adapters, Asterisk/telephony, and audio/RTP regressions.

Backend TypeScript, dashboard TypeScript, production Vite build, and `git diff --check` passed. The installed local executables were used for the repository's test/typecheck/build commands. Full tests ran with local UDP binding available for the RTP fixtures.

## Remaining limits and a pre-existing Calendar concern

Follow-up: the Calendar concern in item 5 below was subsequently reproduced and fixed in the separately requested [Google rescheduling event-identity work](google-rescheduling-event-identity-2026-09-14.md). The original findings and test count below describe the conversation-only change at completion.

1. **No fresh live phone, live model conversation, or real Calendar write was performed.** The optional live Realtime test was skipped. Calendar/provider tests use doubles; voice tests use simulated protocol events and audio fixtures.
2. Silence-based VAD cannot perfectly distinguish a long mid-sentence pause from a finished answer. Instructions and the current grace period help, but acoustic echo, fillers, and natural semantic corrections still need live-phone verification. Semantic VAD was not enabled as part of this narrow fix.
3. An unresponsive provider/media path terminates explicitly rather than leaving an answered call silent forever. A spoken apology cannot be guaranteed when the same speech provider or output transport has failed.
4. A timed-out mutation may still finish externally. The call receives an uncertain outcome and further calendar mutations are blocked for that call; the clinic must verify the calendar. Late results do not generate another confirmation. This does not cancel the underlying Google request or reconcile another future call.
5. **Pre-existing rescheduling concern, unchanged:** the appointment service creates a replacement using the existing appointment ID, while the Google adapter derives its event ID from that appointment ID and treats HTTP 409 as success. The service then cancels the old external event. By code inspection, the replacement can therefore refer to the original event and cancellation can delete it. Existing mocked rescheduling tests pass but do not establish correct live Google behavior for this collision. This is outside the requested conversation fix and was not changed; it needs a separate targeted Calendar regression/fix before claiming live rescheduling is verified.

The implementation closes the reproduced gaps; it is not a guarantee against all provider outages or every possible acoustic/model error.

## Documentation checked

OpenAI's [Realtime conversation guide](https://developers.openai.com/api/docs/guides/realtime-conversations) documents client-managed WebSocket playback truncation. Its [VAD guide](https://developers.openai.com/api/docs/guides/realtime-vad) distinguishes silence-based and semantic turn detection. The installed SDK event definitions were also checked for matching speech/commit item IDs and WebSocket handshake options.
