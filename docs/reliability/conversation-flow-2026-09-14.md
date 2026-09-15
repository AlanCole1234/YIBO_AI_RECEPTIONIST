# Conversation flow reliability — September 14, 2026

## Reproduced causes and changes

- A completed opening greeting could be requested again by a later `session.updated` event. The session now records that the greeting was sent and consumes it once.
- Concurrent incoming-call notifications passed the asynchronous repository check together. Ten notifications produced ten answers/sessions before the fix. Startup now has a synchronous per-call promise claim; replayed notifications share the same startup. Hangup waits for startup and performs cleanup even if startup throws.
- Realtime was configured with an eight-second idle timeout and instructions to reprompt. Idle prompting is now disabled (`idle_timeout_ms: null`); ordinary silence does not request another response.
- The greeting asked for a time while the general instructions asked for a day. The greeting now asks one day question. Instructions acknowledge that question and direct the model to ask only for missing information.
- Replaying identical speech-boundary event IDs after a response completed could request a second response. Input event IDs are now handled once per session.
- Interruption previously required an audio playback position, so a response generating its first audio could escape cancellation. Active generation can now be cancelled before audio exists. A late response acknowledgement is also cancelled if caller speech overtook it, including a short caller turn that already finished.
- Late output from cancelled/completed responses or truncated audio items is ignored. Response completion events still clear the response gate and release pending caller/tool work.

The existing central response-request path, confirmation claims, tool/result deduplication, and booking recovery remain in place. The existing speech-end detection, short turn grace period, sustained barge-in threshold, and echo protection were retained. No new silence reprompt timer or large scheduling state machine was introduced.

## Verification

Final local suite: **470 passed, one optional live test skipped**, across 34 passing test files. Backend TypeScript, dashboard TypeScript, dashboard production build, and `git diff --check` passed.

New regression coverage includes repeated greeting/session callbacks, ten concurrent incoming notifications, startup/hangup races, idle timeout configuration, silence after questions, slow/resumed speech boundaries across six conversation stages, cancellation before playback, delayed response acknowledgements, and replayed input events. The silence checks include a 60-second interval with no caller input. These use simulated Realtime/VAD events rather than recorded telephone audio.

The full suite also exercises scheduling availability and alternatives, confirmation and duplicate-tool protection, booking continuation, cancellation, rescheduling, customer updates, scheduling changes, Calendar timezone conversions and duration, duplicate booking/event protection, Asterisk adapters, and RTP/media behavior. Existing stress checks include 50 sequential sessions, 50/100 conversational turns, and 50 scheduling changes. Calendar/provider regression tests use test doubles; this run did not create a live Calendar event.

## Live verification limits

No fresh live Realtime or real-phone validation was completed for this change. The earlier approved live confirmation checks passed 16/16 paced cases, then a broader run passed 18 cases before reporting `credit_balance_exhausted`; those results predate this change and do not validate the new behavior. See `confirmation-freeze-2026-09-13.md` for the earlier evidence.

Once live testing is available, verify a phone call with silence after the opening, a short day answer, a slow answer with pauses, interruption while YIBO is preparing/speaking, and booking confirmation. Confirm the spoken appointment date/time against exactly one Calendar event in the clinic timezone. Real acoustic echo and model wording require that live check.

Changes remain in the working tree; no commit, push, merge, or deployment was performed.
