# Operational observability — OBS-001

## Output and correlation

Production diagnostics now use newline-delimited JSON on standard output. Retain
and index these records with the deployment's log collector. No new public metrics
endpoint, storage system or provider integration is introduced.

`event` and `timestamp` identify a record. `tenant`, `location` and `call` are stable
24-character SHA-256 prefixes of trusted identifiers (location includes tenant).
They are correlation tokens, not authentication credentials. Search by `call` to
join conversation/tool events with media logs. Scoped async context adds trusted
tenant/location/call correlation to calendar work performed inside a call's tools;
concurrent calls retain separate contexts. Media allocated before conversation
startup has call correlation only; non-call admin calendar operations have the
context available at their call site, without a fabricated call ID.

The allowlist drops transcripts, audio, tool arguments/results, confirmation tokens,
customer names/phones/emails, free-form date expressions, booking dates/times,
calendar/event IDs, provider messages, hostnames and credentials. Unknown error
codes become `OTHER`. Existing production Google/appointment/tool/Realtime/ARI/RTP
loggers use this filter. High-frequency per-frame diagnostics are suppressed;
media summaries and errors remain. Explicitly injected diagnostic loggers and the
local Voice Lab event observer retain their existing contracts and are not a
production logging destination. Do not enable transcript capture in production.

## Events and counters

Count records by event, phase and allowed code in the collector:

- `call.started`, `call.session_ended`, `call.hangup`, `call.cleanup.failed`.
- `conversation.vad`: speech start/stop and silence timeout.
- `conversation.response`: started and safe completion status, including cancellation.
- `conversation.tool`: tool start/completed/failed. These describe execution/results,
  not a claim that the caller heard the response.
- `conversation.confirmation`: required, invalid, mismatched, expired or premature
  confirmation gates. Tokens and arguments are never logged. A later successful
  mutation result is separately visible as the completed tool.
- `conversation.calendar_failure`, `conversation.transfer`, `conversation.error`.
- Existing `calendar.*` events remain, with only safe metadata. In particular,
  `calendar.user.confirmed` precedes booking and must not be counted as booking
  success; use `calendar.booking.completed` or successful tool completion.
- RTP errors/underflow/stall events and `telephony.media.rtp_quality_summary` retain
  measured packet count, interval percentiles and buffering fields. Unsupported or
  unmeasured fields are omitted rather than invented.

## Latency definitions (milliseconds)

`conversation.latency` carries `metric` and `durationMs`:

| Metric | Measurement |
|---|---|
| `session_startup` | Opening the Realtime runtime until session creation returns |
| `speech_to_response` | Local receipt of speech-stopped until first response-created event |
| `speech_to_first_audio` | Speech-stopped until first assistant audio delta |
| `speech_to_response_done` | Speech-stopped until first response-done, including tool-only responses |
| `turn_duration` | Speech-stopped until the last response-done before next caller speech or closure |
| `first_audio_to_rtp` | First audio delta received by ConversationService until the corresponding first UDP send completes, including peer wait/conversion/prebuffer |
| `tool_round_trip` | Tool execution start until result delivery to the runtime completes |
| `cleanup` | Runtime/media close operations, including their existing timeout bounds |
| `session_duration` | Session start attempt through cleanup (or startup failure) |

Timings use a monotonic clock. Response-created measures provider acknowledgement,
not the instant `response.create` was sent. Turn duration describes model response
completion, not the end of audible playback; inspect response status for interrupted
or failed turns. Greetings have no invented caller-speech latency. Browser Voice
Lab has no RTP metric. Failed/never-sent packets have no successful first-RTP sample.

At close, each metric emits `conversation.latency_summary` with sample count and
nearest-rank p50/p95. Each retains at most the **last 256 samples per call**; tool
starts are capped at 100 and audio-turn timing entries at 32. Close releases this
state and emits summaries once. Low sample counts are visible; they are not evidence
of a statistically meaningful live percentile. Do not average per-call percentiles
into a fleet percentile: aggregate raw latency samples in the collector instead.
No global defaults or latency tuning are changed or claimed faster by this task.

Telemetry writes and listeners isolate synchronous observer exceptions and do not
await external collectors, retry tools, change timeouts, or alter media pacing.
Runtime observation is independent from the existing Voice Lab observer.

## Validation — 2026-09-17

65 focused tests passed. New coverage verifies privacy allowlists, stable context,
concurrent async call correlation, bounded samples/percentiles, timing deduplication,
no synthetic greeting/RTP latency, safe failure/confirmation/transfer events,
observer failure isolation, conversation cleanup and actual UDP first-frame timing.
The full suite passed **394 tests, 1 optional live test skipped**; both typechecks
and the production build passed. No live OpenAI, PBX or Google calls were made.

Manual deployment check: make a synthetic test call, identify its `call` token,
verify VAD/tool/media records join and exactly one set of summary records appears
at closure. Exercise a test booking and a denied/failing calendar operation; verify
no caller content or provider credentials appear. Collect representative traffic
before evaluating p50/p95. Process crashes cannot emit a final summary; raw samples
already emitted remain available to the collector. Log retention/access controls
are a deployment responsibility. SEC-001 is next and was not started.
