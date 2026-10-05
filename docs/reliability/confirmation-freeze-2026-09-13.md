# YIBO confirmation freeze: fixes and measured results

**Local fixes are implemented and validated. Full live acceptance remains incomplete because the API returned `credit_balance_exhausted`. No commit, push, merge, deployment, or real Calendar write was performed.**

The working tree already contained substantial changes before this task. This task preserved those changes and did not alter Telnyx, Asterisk, ARI, External Media, RTP format, PCMU, resampling, DID routing, the greeting, timezone/future-date calculations, or existing barge-in thresholds.

## Root causes and exact stopping points

| Finding | Evidence before correction | Correction |
| --- | --- | --- |
| Committed caller turn lost its wakeup | `speech_started → speech_stopped → committed → patience timer` was blocked by the preceding active response. `response.done` cleared the gate but never retried the waiting caller turn. Regression expected one response request and observed zero. | One `resumeWaitingWork` method re-evaluates pending work when response/tool/playback gates open. The existing commit/patience pipeline remains authoritative. |
| Completed function call replay accepted | Replay protection only covered active tool IDs. After the result, replay produced two function outputs. | Completed tool IDs and outputs remain deduplicated for the session. Duplicate response completions cannot clear a newer pending response. |
| One confirmation admitted concurrent booking requests | Consent was consumed after asynchronous creation. Regression observed two appointment-service invocations using one confirmation. This proved duplicate invocation, not two actual Google events. | Consent is claimed synchronously before the first booking await. Claimed proposals cannot be reconfirmed. |
| Provider not tied to offered slot | A confirmation could name a provider never offered at the matching time. New regression failed before the fix. | Confirmation verifies the exact offered provider/time pair and service. |
| Thrown booking tool exception closed the conversation | Existing exception handler failed and closed the session. | Exceptions return a correlated safe failure result; follow-up audio and tools remain usable. Delivery failures and disconnected sessions remain terminal. |
| Live provider failed after successful simulated booking | Captured `response.done`, `status: failed`, `status_details.error.code: rate_limit_exceeded`. The account reported a 40,000-token/minute limit. In one diagnostic batch, three affected replies recovered once; one recovery was rate-limited again. | Added failed-response reason logs, one speech-only booking recovery, and explicit runtime failure after exhausted recovery rather than pretending silence is a completed turn. Pacing live tests avoided the burst limit. |
| Text-mode watchdog repeated a completed reply | Regression observed two response requests after successful text output. | Text output clears the booking watchdog in text sessions, just as audio does in voice sessions. |

The production phone incident was not supplied as a recording or correlated trace. The local lost-wakeup defect and live rate-limit sequence are demonstrated failures; neither is claimed as conclusively the exact cause of the user's original call.

## Confirmation, booking, and response continuation

A short yes uses the same caller-turn commit and response decision as other answers. No special confirmation speech path bypasses normal handling. The 650 ms server silence setting, 100 ms local grace, and 220 ms sustained-speech barge-in protection remain unchanged.

The prompt now includes Yes, Yeah, Yep, Sure, That's fine, Go ahead, Book it, and Yes please. It excludes Maybe, I think so, Hold on, Wait, Let me check, Actually, unclear speech, silence, and stale consent. Required contact/service details are collected before final confirmation; successful confirmation should immediately lead to creation for the same slot, without a second yes.

Consent is consumed before asynchronous booking work. A new availability request invalidates the old proposal. A changed proposal is checked again before entering the appointment service, and completion of an old booking cannot erase a newer proposal. The existing appointment-service validation, Calendar synchronization, and idempotency safeguards remain active. A failed mutation does not restore consent or automatically retry.

The model still interprets caller intent and requests confirmation/creation tools. These changes do not introduce a deterministic transcript-based consent authority. A fresh model-invented availability/confirmation sequence remains a different risk from replaying one tool ID or reusing one recorded confirmation.

Automatic VAD response creation stays disabled. Tool outputs continue through `conversation.item.create` followed by the single guarded `response.create` path. This matches the [official Realtime function-result continuation guide](https://developers.openai.com/api/docs/guides/realtime-conversations#provide-the-results-of-a-function-call-to-the-model). The SDK and live WebSocket checks confirmed this sequence.

## Watchdog and state synchronization

The booking watchdog waits 3,500 ms after a result. With no active response, playback, caller speech, or tool, it can issue exactly one recovery response with `tool_choice: "none"`. It cannot call booking or create a Calendar event. Busy conditions defer the check. Reply output or disconnect clears the timer. If the recovery response also fails, the failure is surfaced to the conversation controller; this cannot guarantee speech when the provider itself refuses to generate it.

Pending caller work retains priority over tool continuation, including its existing patience and commit boundaries. Playback completion does not erase an active tool. Completed/stale response events do not create additional responses. The optional public `ToolExecutor.releaseCall(context)` hook clears proposals and invalidates pending availability work on disconnect. Older asynchronous availability results cannot overwrite newer requests.

An already submitted Calendar mutation is not rolled back merely because the caller changes their mind. The old consent cannot authorize the new slot; a completed old appointment may require a subsequent rescheduling/cancellation decision.

## Test results

**Final full local run: 455 passed, 1 pre-existing optional live test skipped, 35 files, 6.82 seconds.** That optional live test was run separately with the project environment and passed in 2.70 seconds before credit exhaustion. Thus all 456 suite tests passed across those runs. No failing test was deleted, skipped, or weakened. No new skip was added.

There are **237 added local tests**:

| Coverage | Result | Scope |
| --- | --- | --- |
| Short yes audio | 50 passed | 60–256 ms synthetic PCM, injected provider VAD/commit/transcript events, exactly one response request, timer cleanup. Measures submitted audio, not real acoustic recognition. |
| Tool output / response races | 25 passed | Both result/completion orders and duplicate old completions. |
| Booking response watchdog | 25 passed | Success/failure envelopes, one tools-disabled recovery, no duplicate function output, timer cleanup. |
| Thrown booking tool failure | 25 passed | Correlated failure, no forced disconnect, subsequent audio and tool execution. |
| Concurrent booking duplicates | 25 passed | 2–26 competing requests per confirmation; one appointment-service invocation. |
| Successful booking / consent replay | 25 passed | One booking and no reauthorization by a replayed confirmation. |
| Schedule changes | 25 passed | New availability invalidates earlier consent and prevents use of it. |
| Confirmation interruption | 25 passed | Sustained input audio, accepted barge-in, one cancellation, preserved input frames, committed reply resumes once. |
| Long lifecycle | 2 passed | 50 and 100 caller turns, one response per turn after 100 ms virtual grace, no residual timers each cycle. |
| Long scheduling application E2E | 1 passed | 50 scheduling changes through real application services, five separately confirmed appointments, five in-memory Calendar intervals, duplicate attempts rejected, call cleanup. |
| Sequential connections | 1 passed | 50 fresh connections, greeting/tool state isolated, reused tool IDs accepted only in new sessions, one close each. |
| Targeted regressions/cleanup | 8 passed | Initial lost-wakeup/replay/concurrency reproductions, disconnect during availability, 50 overlapping domain contexts, text watchdog, exhausted provider recovery, offered-provider check. |

Existing scheduling, appointment, Calendar adapter, conversation, call orchestration, Realtime, tool, barge-in, media, RTP, API, database and in-memory call-to-appointment tests passed. Loopback UDP tests initially hit sandbox permission errors and passed with the required loopback access.

Commands used installed executables: `node_modules/.bin/vitest run`, `node_modules/.bin/tsc --noEmit`, `node_modules/.bin/vue-tsc --noEmit -p dashboard/tsconfig.json`, and `node_modules/.bin/vite build --config dashboard/vite.config.ts`. Both typechecks and the production build passed. `git diff --check` passed. The initial pnpm wrapper did not promptly start; no dependency upgrade was needed.

## Live confirmation results and latency

The user explicitly approved sending the test workflow/tool definitions and fictional scheduling context to OpenAI Realtime. All booking outputs were simulated; the live checks do not call a Calendar adapter. These are real model/WebSocket text checks with a seeded exact prior proposal, not acoustic phone tests.

- Initial 16-case runs exposed intermittent failed continuations. Raw failures remain saved; they were not replaced by passing results.
- A diagnostic run captured the account rate-limit error and one-shot recoveries.
- **Paced phrase check: 16/16 passed.** Each of eight affirmative phrases made exactly one confirmation and booking and received final response text. Each of eight ambiguous/hold phrases made no confirmation or booking.
- **150-case matrix: 18 passed, then 3 requests failed with `credit_balance_exhausted`.** Execution was stopped; 129 cases were not attempted. Therefore 132 planned cases remain unproven, including the designated 25-case live booking-failure group. The runner now stops immediately on exhausted-credit errors.
- Successful paced phrase checks took **762–2,744 ms**, median **1,560.5 ms**. This includes connection/setup through final text response; it is not telephone audible latency.
- The first 18 successful matrix yes cases took **2,275–3,353 ms**, median **2,593.5 ms**, through final text response.
- Local 50/100-turn tests retained the **100 ms virtual grace** without timer accumulation. This is not a measurement of live model or carrier latency.

Evidence files in this directory:

- `live-confirmation-initial-results.json`: first unsuccessful smoke run.
- `live-confirmation-failure-traces.json`: subsequent raw failed-continuation traces.
- `live-confirmation-rate-limit-evidence.json`: explicit provider rate-limit errors and watchdog actions.
- `live-confirmation-paced-smoke.json`: 16/16 successful paced phrase check.
- `live-confirmation-credit-blocked-results.json`: partial matrix and exhausted-credit errors.
- `live-confirmation-results.json`: latest partial matrix checkpoint.

The prepared runner is `scripts/reliability/live-confirmation-check.ts`; `--matrix` selects the 150-case matrix. It runs serially with a ten-second minimum interval to respect the observed account limit. It should only be rerun after credits are restored.

## Tracing and remaining limits

`telephony.booking_confirmation.trace` records adapter events/state transitions and domain confirmation/claim decisions, correlated by call ID/tool ID. Domain records include the actual proposal ID and selected provider/service/time. Adapter fields that it cannot know are null, rather than invented. `telephony.conversation.response_failed` now exposes provider response ID, failure code and redacted message. Existing `telephony.conversation.invalid_state`, barge-in, first-audio, RTP and latency logs remain available.

This is not yet a single complete snapshot joining every requested field across runtime, domain and transport. Input transcript remains unavailable unless the provider emits a transcription event; this task did not enable an additional transcription model. The [official transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription) describes that separate configuration and asynchronous item correlation. Tool arguments must not be presented as evidence of the caller's exact words.

Outstanding acceptance limits:

- Credits must be restored before further live model checks or real-phone validation using this API account.
- Full 150-case live interpretation/booking matrix is incomplete; its missing quota is not represented as passing local tests.
- Real acoustic yes detection, every phone-stage interruption, repeated realistic phone conversations, and actual speech-end → audible reply latency remain unmeasured.
- Existing barge-in tests plus 25 new confirmation-interruption cases pass; they do not replace testing actual echo, noise, accents, and phone audio.
- 50/100-turn lifecycle tests, a real-service 50-change E2E, 50 sequential runtime connections, and 50 overlapping domain contexts pass. No production heap/listener profile or real telephony soak test was performed.
- The watchdog cannot make an unavailable/rate-limited provider speak. Exhausted recovery now surfaces a terminal runtime failure instead of leaving a silently completed-looking turn.
- The model remains the intent interpreter. Immediate confirm → create is guided by prompt and reliable continuation, not a new server-side lexical confirmation engine.

## Exact real-phone test after restoring API credits

1. Start a fresh call. Verify the current YIBO-speaks-first greeting.
2. Ask for Friday around ten, change to Monday, then request 10:30. Use a genuinely available future date in the clinic timezone. Supply any required contact/service details before final confirmation.
3. After the exact provider/service/date/time offer and booking question, say **Yes** once, briefly.
4. Verify one Calendar event, one spoken success, and a return to listening. Say **Thanks** and verify a reply.
5. Repeat with **Yeah**, **Yep**, **Sure**, **That's fine**, **Go ahead**, **Book it**, **Yes please**. In separate calls use **Maybe**, **I think so**, **Hold on**, **Wait**, **Let me check**, **Actually…**, and silence; none should create an appointment.
6. Interrupt the confirmation with a different day/time. Require new availability, an exact proposal, and fresh consent. Also interrupt the greeting and booking-success speech.
7. In a controlled development failure fixture, return a booking error and verify an apology plus a usable follow-up conversation. Do not break production credentials to simulate a Calendar failure.

If a freeze recurs, retain the interval from the preceding proposal until at least ten seconds after yes, plus call ID, timestamp/timezone and the actual spoken words. Send:

- `telephony.booking_confirmation.trace`
- `telephony.turn.speech_stopped_candidate`, `speech_committed`, `user_audio_summary`, `user_transcript_available`
- `telephony.turn.response_decision`, `response_requested`, `response_started`, `first_audio_received`
- Realtime `response.function_call_arguments.done`, function output, `response.created`, `response.done`, errors, and especially `telephony.conversation.response_failed`
- `appointment.confirmation.recorded`, `appointment.booking.blocked_missing_confirmation`, Calendar request/result events
- `telephony.booking.response_watchdog`, `telephony.turn.response_watchdog`
- `telephony.conversation.response_blocked`, `invalid_state`, duplicate/stale-event logs
- `telephony.turn.first_rtp_sent`, `telephony.turn.latency_summary`, playback-idle and barge-in events
