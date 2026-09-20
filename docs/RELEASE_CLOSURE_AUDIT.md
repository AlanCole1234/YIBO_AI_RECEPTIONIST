# REL-002 — release-closure audit

Date: 2026-09-19. Audited code: `12fb73205952aef18450c82a8ec79c531e05b7e9`.
**Outcome: roadmap closure incomplete.** Update after CLOSE-001 (2026-09-19):
intentional final playback/end-call is implemented. Update 2026-09-20: CLOSE-002
is also implemented (guarded mapping policy); final REL-002 re-audit is next.
See [call completion](CALL_COMPLETION.md). The findings below record the audit baseline. No production implementation, deployment,
calendar data, or original database was changed by this audit.

## Closure rule

The integration handoff permits closure only with no contradictory documentation,
unowned open tasks, or hardcoded controls explicitly promised as configurable.
Contract-level provider fakes are permitted. Missing live acceptance alone does not
invalidate the automated integration work, but cannot be presented as production proof.

## Verified evidence

| Area | Evidence |
|---|---|
| Integration and preservation | `INTEGRATION_INVENTORY.md`, separate ARI/media/runtime commits, baseline checkpoint `b87eeb0`; original work remains on its separate checkout/branches. |
| UI sequence | History contains UI-004 through UI-009 in order, with separate commits, status entries and focused tests. |
| Configurable controls | Agent schema/defaults v4, validation, prompt compiler, payload builder, policy executor and dashboard controls consume persisted model/audio/VAD, behavior, silence, tool/channel/confirmation/retry/escalation settings. Location editor exposes scheduling policies and transfer destination; catalog/calendar editors expose assignments and prices. |
| Intentional constants | PCM16 mono 24 kHz, RTP format, bounded tool/provider deadlines and confirmation-token TTL are transport/safety contracts; the roadmap does not promise them as editable admin controls. No competing provider-control override was identified in the inspected modern payload path. |
| Security/observability | SEC-001 and OBS-001 commits and regression suites; scope-bound tool state, privacy-filtered metrics and authenticated/CAS admin APIs. |
| Automated E2E | E2E-001/002 cover routed booking, two locations, event identity, listing/change/cancel, transfer, outage, competing slots and PBX/media failures. Boundaries are simulated, not live providers. |
| Migration | REL-001 migrated private local MX/US copies 4→9, checked repeatability, preserved original columns and verified backup restore. Sources had no appointments/customers. |
| Latest full baseline | REL-001: 443 passed, one optional live test skipped; both typechecks and production build passed. |

## Open work with explicit ownership

Owners below are functional roles for the next implementation/deployment work; no
external person has been notified or assigned through a service.

### CLOSE-001 — final-response playback and intentional call end

**Owner:** conversation/telephony implementation task. **Status:** DONE under ADR-008.
The following describes the pre-fix finding; current behavior and tests are in CALL_COMPLETION.md.

Evidence: `AgentToolName` and the published tools have no modern end-call action.
Realtime `response.output_audio.done` emits `assistant.audio_completed` and
`response.done` emits response completion, not session termination. Conversation
observes those events without an intentional end-call transition. The E2E tests
close by caller hangup, injected runtime `closed`, or failure. These demonstrate
cleanup, not a natural final-response/playback-complete end-call path.

Required follow-up: define the intentional end-call contract within the modern
architecture, distinguish ordinary response completion from conversation completion,
wait for final playback, handle caller interruption and pending/uncertain tools,
and test exactly-once cleanup without prematurely ending ongoing conversations.
This needs a reviewed lifecycle decision (ADR discipline in BUILDING_GUIDE), not
string-matching goodbye text or closing on every `response.done`.

### CLOSE-002 — routing changes with existing appointments

**Owner:** appointments/calendar implementation task. **Status:** DONE (2026-09-20).
ADR-009 guards mapping saves atomically against non-cancelled bookings. Historical,
pending/failed, override/fallback and integrated Google lifecycle cases pass; see
[verification and limits](BOOKED_CALENDAR_ROUTES.md). The following is pre-fix evidence.

Evidence: `BusinessCalendarAssignmentResolver` resolves the *current* location/
professional assignment. Appointment records retain the external event ID but not
the calendar route used at creation. Reschedule/cancel resolve that current route;
a later admin mapping change does not migrate the old event. UI-007 warns about it.
E2E-002 uses an unchanged mapping, so it does not close this item.

Required follow-up: decide and implement safe handling (for example, a guarded
mapping-change policy or persisted booking route with a compatible migration), then
test old and new bookings, professional override/fallback changes, reschedule and
cancel. Never move/delete/recreate live events implicitly. Preserve ownership/etag
checks and define handling for historical rows without a route snapshot.

### ACCEPT-001 — live and browser acceptance

**Owner:** deployment operator with access to the intended test PBX/carrier, Google
account and browser. **Status:** OPEN; production-acceptance gate.

Run the synthetic-contact/test-calendar scenarios in VOICE_BOOKING_E2E and
PHONE_OPERATIONS_E2E, plus the UI-009 two-tab conflict and unsaved-change checks.
Record spoken confirmation/time, transfer, cleanup, calendar permission and actual
provider outcomes. Current tests do not prove autonomous goodbye, intelligibility,
network reachability or valid live credentials.

### DEPLOY-001 — target data and operational safeguards

**Owner:** deployment operator. **Status:** OPEN before rollout, not an unperformed
part of the completed local-copy rehearsal.

Identify the actual target database/host, take durable protected backups including
required keys, provision admins, set a stable session key, verify complete Google
settings and a PBX-only RTP network. Rehearse separately if target data differs from
the local sources. The local copies contain no appointments and temporary `/private/tmp`
artifacts are not durable backups. Concurrency evidence covers one app instance.

## Documentation reconciliation

Historical reports retain their dated evidence. Current links/status now point to
this audit rather than assigning unfinished work to tasks already marked DONE.
The audit originally reopened E2E-002 for these deferred items. With CLOSE-001 and
CLOSE-002 complete, E2E-002 is DONE and REL-002 awaits its final re-audit. Original
operational scenarios remain valid; no completed tests or preserved work were discarded.

Next task: re-run the REL-002 closure audit. Both implementation follow-ups are
complete; CLOSE-002 full checkpoint validation passed. Live deployment acceptance
must remain separately reported even if the software roadmap is later closed.

## Original audit validation — 2026-09-19

43 focused tests passed for configuration, prompt, dashboard controls, Realtime
payload, conversation and calendar routing. Both typechecks and production build
passed. No production code changed, so the 443-test REL-001 full-suite baseline
was the latest full run at that audit. CLOSE-002 later passed 477 tests and one
optional live skip, both typechecks and build.
