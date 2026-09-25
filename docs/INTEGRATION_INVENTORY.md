# Three-source integration inventory

> Historical integration evidence. Deferred work and current ownership were audited
> on 2026-09-19 in [RELEASE_CLOSURE_AUDIT.md](RELEASE_CLOSURE_AUDIT.md).
> UI-004/OBS-001 are complete; final playback/end-call and existing-booking routing
> are tracked as CLOSE-001 and CLOSE-002 (both now implemented). Older “next task” wording below is dated.

## Preservation and verified baseline (2026-09-15)

Canonical modern source: `origin/codex/recovered-work` / `1ff998b`. Published Alan source: `origin/feature/telephony-integration` / `9183e76`, unique commits `f4331a4`, `9fafd6d`, `9183e76`, merge-base `e0f4343`. Local source: remote backup `backup/alan-local-before-integration` / `54e4b9b`, preserving 63 reviewed source/example/documentation/test files over `447c667`.

The original checkout/index were left intact. A private, ignored `.local-preservation-20260915` directory there contains a verified all-ref Git bundle, both anchored stash tips, reflog recovery refs, pre-fetch branch/status/diff inventories, and a SHA-256 manifest/archive of all 69 modified/untracked files. Six diagnostic JSON artifacts remain private and were not added to the source snapshot. Credentials, ignored `.env`, databases and local runtime artifacts were not added. The local-only `edd624e` styling commit also has remote backup `backup/alan-app-shell-20260915`. The initial dashboard `b301132` and older stash `8b597d3` are anchored locally and bundled. Both original stashes remain untouched.

All local branch tips were compared with remote reachability. Aside from preserved working changes and stashes, `edd624e` is the only non-remote commit on normal local branches; its other upstream-ahead commits already exist remotely. The two stashes contain old ingress/composition wiring and older telephony/workspace contracts. No PBX configuration files were found in standard local Asterisk directories or repository shell/config files. Deployment-specific credentials/ports remain in the ignored local environment, untouched.

Baseline: 270 tests passed, one optional live test skipped; backend and dashboard typechecks and production build passed. The lockfile is byte-identical to the original checkout's installed dependency lockfile. The pnpm launcher stalls on this machine; installed matching local tsc/vue-tsc/vitest/vite executables execute the package scripts equivalently without modifying dependencies or tenant data.

## Behavioral reconciliation

| Evidence | Classification | Modern disposition |
|---|---|---|
| `f4331a4`, stash 0 authenticated HTTP event ingress | REIMPLEMENT | ARI authenticated outbound subscription is the production ingress; do not add another generic caller-supplied event authority or bypass current authentication/DID resolution. |
| `9fafd6d` ARI transport and local ARI client | PORT | Bounded ARI operations, external-channel exclusion, correct channel-to-call routing; provider boundary only. |
| `9fafd6d` AudioSocket server and old call-runtime/voice-bridge | DISCARD | Superseded for this deployment by locally proven ARI External Media RTP path; no second conversation owner. AudioSocket is intentionally not enabled. |
| Local RTP parsing, PCMU codec, stream resampling, pacer | PORT | Media boundary converts 8 kHz PCMU to canonical PCM16 mono 24 kHz; preserve pacing, bounded buffering and cancellation. |
| Local ARI private test/diagnostic dialed-number bypass | DISCARD | Never bypass modern trusted DID/location and developer-mode isolation. Diagnostics require authorized Voice Lab. |
| Local startup replay protection, early hangup, runtime completion | REIMPLEMENT | Integrate with current location-aware orchestrator and transfer states. |
| Local tool/deadline/late-result recovery | REIMPLEMENT | Keep current confirmation tokens, trusted turn sequence, tool policy and safe error envelopes. |
| Local ad hoc end_call/provider prompt injection | REIMPLEMENT | Any completion action must use modern validated tool/policy/payload contracts, not an adapter-only undeclared tool. |
| Modern persistent customer/appointment repositories, multi-location routing | ALREADY PRESENT | Retain; do not port local in-memory bootstrap or global Calendar ID. |
| Local Calendar identity and conditional in-place reschedule | REIMPLEMENT | Retain routed calendar identity including location/professional, persisted ownership and original event identity. |
| Local successful-booking confirmation and no repeated confirmation | REIMPLEMENT | Public mutation result/prompt with modern opaque references and backend confirmation tokens; no internal ID leakage. |
| `9183e76`, `edd624e`, `b301132` dashboard layouts | DISCARD | Modern role-aware advanced configuration/dashboard wins. No missing functional behavior established. |
| `685fed6`, `447c667` clinic-local dates and availability | ALREADY PRESENT | Validate against modern location timezone and public slot contracts; preserve business policy. |
| Local silence/VAD/token/reasoning overrides | NEEDS BENCHMARK | Versioned settings are authoritative; no global default changes justified by local simulations. |

## Latency classification (exactly one category per mechanism)

| Mechanism | Category | Decision |
|---|---|---|
| PCM16 mono 24 kHz Realtime | A — transport invariant | Shared canonical profile; no PBX-driven change. |
| 8 kHz PCMU, 160-byte/20 ms RTP packets | A — transport invariant | Boundary codec/framing; internal protocol constants. |
| VAD mode, threshold, padding, silence, inactivity | B — agent configuration | Honor current validated schema and capabilities; no adapter override. |
| Voice/model, reasoning effort, output tokens, noise reduction | B — agent configuration | Canonical defaults/upgrader; preserve saved tenant choices. |
| create_response, interrupt_response, truncation, tracing, tool policy | B — agent configuration | Preserve validated payload and channel restrictions. |
| Local 650 ms silence / 100 ms local grace recommendations | C — candidate product defaults | Not adopted globally: no measured multi-channel p50/p95 evidence. |
| Stateful downsampling and avoiding repeated conversion | D — internal optimization | Port and test sample continuity across chunk boundaries. |
| RTP pacing, prebuffer, capacity, cancellation/backpressure | D — internal optimization | Bounded media implementation; no arbitrary admin JSON. |
| Progress deadlines, deduplicated tool/response events, async accounting | D — internal optimization | Reimplement around modern contracts; never retry an ambiguous mutation. |
| Speech-end/first-audio/tool/RTP timing observations | D — internal optimization | Correlated metadata only; formalize in OBS-001. |

No claim of live latency improvement is made. Historical local samples are protocol simulations, not a live p50/p95 dataset. Default changes require additional evidence. These dispositions are revisited only when tests/code show a missing behavior.

## INT-001 transport foundation

The first independently reversible change adds ARI controls with a four-second HTTP abort, excludes external-media StasisStart from caller ingress, and ports tested RTP parsing and stateful PCMU conversion. It preserves the modern shared Realtime transport constant and does not yet connect PBX to the application. Authentication, tool contracts and dashboard are unchanged.

## INT-001 media boundary

The second port adapts the local RTP pacer and transport to the current AudioSink boundary. Caller-number diagnostic bypasses are removed. Media waits at most four seconds for its peer instead of dropping greeting audio; close releases that wait. The learned peer is pinned, inbound queues are capped, and outbound overflow rejects the write instead of deleting old speech. Pacing stays 160 bytes/20 ms, with stateful resampling and cancellation. Timing retained here measures first model audio to first RTP; full turn correlation belongs to OBS-001. No provider setting or tenant default is changed.

Validation: transport foundation 10 focused tests passed; media boundary 9 focused tests passed (a new capacity test was corrected to account for the first packet already dispatched). Both backend/dashboard typechecks passed. Runtime wiring and integrated E2E remain the next INT-001/INT-003 work.

## INT-001 application wiring

The API process now optionally creates the authenticated ARI client and media gateway from explicit environment settings; Voice Lab never enables this ingress. Media is prepared only when the orchestrator answers after trusted DID/location resolution. Existing persistent regional repositories, calendar assignment routing and versioned agent creation are untouched. Duplicate incoming events share startup; runtime completion closes/hangs up once, while transferred calls keep their terminal status. Close releases media and ARI subscriptions.

The current ConversationService retains trusted turn sequencing and confirmation/policy wrappers while adding bounded audio/tool/cleanup waits, duplicate tool-ID protection, safe failure envelopes, and no mutation retry after an ambiguous timeout. No old standalone VoiceBridge or unvalidated provider payload is introduced.

Validation: 41 focused tests passed across call orchestration, conversation service, confirmation gate, tool policy, telephony gateway and the new modern Asterisk E2E; backend/dashboard typechecks passed. The deterministic E2E uses fake ARI/Realtime providers at their boundaries, real trusted DID resolution and agent/tool modules, real RTP socket allocation/cleanup, and rejects unknown DIDs before media allocation. No live provider writes or application restart occurred during integration.

Production setup: enable the complete ASTERISK_ARI settings in the API environment and bind the RTP range to a private interface. Route Stasis arguments to the configured clinic DID. Restrict ARI and UDP to the PBX network. Do not configure private-number diagnostic bypasses; use authorized Voice Lab instead. Process termination closes the PBX resources. INT-002 still owns response pacing and provider-setting reconciliation; INT-003 must pass before UI work resumes.

## INT-002 response sequencing

Tool outputs retain the full modern envelope, including opaque confirmation tokens.
Results are delivered once per tool-call ID. A local response request reserves the
response slot until response.created arrives, preventing a second tool result from
creating a competing response during that gap. Pending results wait for the current
response; automatic VAD owns the next caller turn when enabled. With automatic
responses disabled, pending tool output resumes after speech stops. This is category
D bookkeeping, not a change to configured VAD or provider defaults.

Validation: 43 focused conversation/Realtime tests passed and both typechecks passed.
The four added regressions cover token preservation/deduplication, active-response
ordering, delayed response-created acknowledgement, and failed tool output during
speech with automatic responses disabled. Provider protocol reference checked:
https://developers.openai.com/api/docs/guides/realtime-conversations .
No live latency or phone-call improvement is inferred from these deterministic tests.

### Realtime connection startup

The installed OpenAI SDK explicitly reports unhandled rejections when no SDK error
listener exists. Registering it only after the socket opens left startup exposed.
The listener now exists immediately; a socket close before open rejects startup,
and the SDK WebSocket receives a 10-second handshake deadline. Provider errors
already forwarded by the generic event channel are not forwarded a second time.
These are internal connection safeguards, not tenant/provider tuning controls.
Three SDK-boundary tests plus the adapter suite passed (30 tests); both typechecks
passed. No external API call was used.

## Preserved Calendar identity fix adapted to routed calendars

Root cause: the recovered reschedule path inserted using the original appointment
ID. Google returned 409 for that already-existing ID; the adapter treated every
409 as success, then the domain deleted that same original event. The appointment
could remain locally confirmed while its Google event was deleted. Separately,
stripping non-hexadecimal characters made IDs ending in x/y/z collide and omitted
tenant identity, allowing unrelated events to be mistaken for successful creates.

The calendar port now offers rescheduleEvent. The domain validates the target slot
and patches the persisted event ID without insert/delete compensation. Google
checks appointment ownership (and tenant marker when present), uses the retrieved
etag for conditional patch/delete, and verifies returned ID/times. A duplicate
create must match ownership and time. New IDs hash the complete tenant/appointment
tuple; existing IDs remain unchanged. Memory and SQLite implement the same port.
The current location/professional CalendarAssignmentResolver remains authoritative.

Validation: 29 focused tests; 306 full-suite tests passed, one optional live test
skipped; both typechecks and production build passed. Eight new provider-boundary
regressions cover formerly colliding IDs, tenant scoping, similar appointments,
repeated rescheduling, cancel after reschedule, exact local times, original ID,
no duplicate inserts, ownership, legacy IDs and etag conflict. Domain regression
now expects the original event ID. No real Google events were changed.

References checked: [conditional modifications](https://developers.google.com/workspace/calendar/api/guides/version-resources)
and [event patch semantics](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch).
Remaining release checks owned by UI-007/E2E-002: calendar-mapping changes with
existing appointments, ambiguous network outcomes, and live-provider verification.
Legacy events without a tenant marker rely on the trusted routed calendar and
matching appointment marker; mismatches fail closed. No database migration here.

## INT-003 green integration checkpoint

At commit 8e4f6e2, all 306 deterministic tests passed (61 test files), with the
optional live Realtime file skipped. Both backend and dashboard typechecks passed;
Vite production build passed. The installed tsc/vue-tsc/vitest/vite executables
were used directly because the pnpm launcher stalls in this environment; they
execute the exact commands configured by the package scripts. UI-004 may now
resume. No global latency defaults or persisted agent settings changed.

Owned remaining roadmap work includes real preview (UI-004), metadata latency
aggregation (OBS-001), administrative routing changes with existing bookings
(UI-007), and natural final-response/playback completion plus transfer/outage
scenarios (E2E-002). The old ad-hoc end_call provider tool remains intentionally
unported; its behavior must use the modern validated tool/lifecycle contracts.
