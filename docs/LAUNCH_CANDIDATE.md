# Launch candidate — release gates

Plan: Alan's six-page `YIBO_Alan_Codex_Instructions.pdf`, read in full before
integration. This document records evidence for the combined candidate; older
branch acceptance does not automatically pass a new release gate.

## 1. Integration checkpoint — complete, 25 September 2026

| Source | Verified remote commit |
|---|---|
| `codex/product-ux-improvements` (first parent) | `7078d49e8ad312f2f4ab797ee184d2e933818297` |
| `codex/yibo-business-operations` (second parent) | `785389f3c6aea89c2f4d26ec1a7b433669f6b668` |
| `codex/integrate-telephony-and-finish` (already in first parent) | `46ce7135a6e6118c14c387b103957868a672645e` |

Fetched and checked against GitHub before creating `codex/yibo-launch-candidate`
in its own worktree. Product/Operations divergence was 10/9 commits (one newer
Product commit than the PDF's snapshot). Both histories remain ancestors of the
merge; source branches, main, and the dirty working-phone checkout are preserved.
No environment files, credentials, customer databases, recordings, or live routes
were copied into this branch.

### Deliberate conflict resolutions

- **Navigation:** Office schedule remains the default operational view; Customers
  and Operations Team availability remain available. Accepted Product Availability
  and Appointments screens stay connected to their existing APIs. Read-only users
  cannot invoke either family's write controls or APIs.
- **Metadata/storage:** appointment location metadata supports both professional
  name contracts and service assignments. Both range queries remain; the Product
  calendar still includes inactive/historical records and enforces its 31-day
  limit. Operations outcomes, customer fields, history and delivery records use
  its additive migration 10 and existing services, with no duplicate subsystem.
- **Configuration:** both location editors' controls survive. Business/channel
  tools, Product location overrides, and Operations AI capabilities intersect;
  restrictions win. Price redaction applies to structured tool output as well as
  the prompt. Saved locale and phone readback survive the new contact gate.
- **Agent:** Operations confirmed-contact persistence and local time/professional
  feedback combine with Product success-only confirmation and function-first
  goodbye behavior. Existing email/profile hooks are reused.
- **Voice Lab:** retain the shared Product session controller, completion and
  playback-drain fixes. Cost reporting observes its lifecycle rather than creating
  another controller. Reset, duplicate completion and late usage have coverage.
- **Google:** preserve the verified events-scope access probe; merge Operations
  refresh/revocation and API-disabled diagnostics. Event routing, ID generation,
  OAuth configuration, stored tokens and provider settings are unchanged.
- **Small integration fixes:** the appointment timeline validates its location
  before returning notification records; legacy UI defaults are normalized before
  capturing the clean editor baseline; cancelled appointments and denied actions
  no longer expose inappropriate Office action buttons.

### Validation evidence

291 distinct focused tests passed across 22 files, including 18 new cases.
Coverage includes both admin API families, roles, tenant/location isolation,
customer history/outcomes, successful/failed/skipped notifications, two reschedules
and cancellation with the original event ID, Google authorization/identity/routing,
agent restrictions/contact/locale/readback, Voice Lab lifecycle/cost, conversation
completion, ARI behavior and the existing scheduling service. One location-scope
notification leak was reproduced and fixed; stale/deduplicated cost events and
untouched legacy settings now have regression tests.

Both backend and dashboard typechecks and the production Vite build passed.
Synthetic v9 MX/US SQLite copies migrate to v10 twice, preserve all original data
and configuration, persist outcomes/events/deliveries and reopen successfully;
source fixture bytes remain unchanged.

Browser smoke test used a separate loopback API (3113) and dashboard (5381), private
synthetic SQLite, in-memory Calendar and no live email/Realtime/telephony providers:

- Office create → Customers directory/history → Product calendar/detail →
  reschedule → Office cancellation and timeline/notification status.
- Correct local date/time and professional in Product details; one booking across
  views; cancellation frees its slot. All email records are correctly `SKIPPED`.
- Office day/week/month/agenda controls, both availability screens, combined
  location controls and clean navigation after loading optional defaults.
- Compact 390 px Office and Settings layouts have no page overflow; visual review
  confirms usable controls. The synthetic appointment is left cancelled.

This is synthetic browser acceptance, not proof of real Google, microphone, phone
or email delivery. The existing Product acceptance browser/setup is untouched.

## 2. Full regression — complete, 25 September 2026

Integration commit `6b82aa9` is pushed on the dedicated launch branch. The full
suite passes **664 tests across 88 files**, with the existing optional live OpenAI
test explicitly skipped (no API key supplied). Both typechecks and the production
build pass. Coverage includes auth/roles/isolation, regional SQLite migrations,
scheduling/calendar identity/routing, customer/office operations and notifications,
configuration/runtime, conversation, Realtime adapter, ARI and local RTP teardown.

The sandbox-only run initially blocked loopback UDP (`EPERM`). Running the fake
PBX/media fixtures with local socket access resolved those environment failures.
Two older booked-calendar-route tests then exposed missing contact confirmation
in their scripts: they now assert the contact gate before using the same persisted
contact flow as callers. Their routing, neighbor-event, repeated-reschedule,
create-in-flight and cancellation assertions remain unchanged. No runtime
workaround or test exclusion was added.

The source feature branches remain `7078d49` and `785389f`; the launch merge's two
parents prove both histories are retained. `main` was neither checked out nor
modified. Next: appointment concurrency, before any multioperator business test.

## 3. RISK-001 — complete, 26 September 2026

Reproduced four races before the fix: delayed reschedule resurrecting a cancelled
local appointment, lost office outcome, duplicate cancellation and stale history
on queued reschedules. The existing appointment service now acquires its shared
location guard before re-reading and comparing the displayed revision. SQLite
migration 11 supplies persistent revisions and a claim shared by configured API
and voice processes. Shipped UIs and voice references provide the revision; stale
edits and competing writes return explicit conflicts before provider mutations.

15 new regressions include two configured database connections, a real child
process, crash recovery on disposable data, provider failure, repeated reschedules,
cancel, unchanged event identity and an untouched neighboring booking. Final suite:
**679 passed, 1 optional live-model test skipped** across 90 passing files. Both
typechecks and production build passed. Synthetic MX/US migration copies now cover
9→11, retained records/revision defaults, idempotence and reopening.

Two-tab synthetic browser acceptance passed in Office and Product Appointments:
stale cancellation rejected after each of two reschedules, explicit refresh/reload
revealed the current time, reviewed cancellation succeeded once and freed the slot.
No live providers or working services were involved.

Claims do not expire automatically: after process death an operator must reconcile
local/Google state before removing the exact abandoned claim. All database writers
must upgrade together. Legacy unversioned HTTP clients remain compatible but do not
gain stale-intent detection. See [contracts, evidence and recovery procedure](APPOINTMENT_EDIT_PROTECTION.md).

## 4. Real Google — complete, 26 September 2026

Code `3046c82` passed against the existing **YIBO Test Appointments** calendar using
a fresh private configured application/database. Existing authorization refreshed
successfully; no Calendar/OAuth settings or live token storage were changed.
Real availability → create two synthetic appointments → verify → reschedule the
primary twice → reject a stale cancellation → cancel → clean up the neighbor all
passed. The original event ID and correct clinic-local instants were retained;
no duplicates, all 15 pre-existing events unchanged, both test events removed from
active lists and both local records cancelled. All operation claims released.

[Real-provider evidence and isolation boundaries](LAUNCH_GOOGLE_ACCEPTANCE.md).
The next gate requires an approved isolated phone path and a human caller.

## 5. ACCEPT-001 preflight — blocked, 26 September 2026

Read-only SSH and the exact ARI info/application/channel/bridge endpoints all timed
out from this Mac. The current loaded routes and media state cannot be verified;
this does not prove the phone service itself is down. No call or configuration
change was attempted. Restore private-network access, inspect the previous 7001
validation failure, and obtain fresh explicit approval before changing its stable
rollback. [Evidence and operator steps](LAUNCH_PHONE_PREFLIGHT.md).

Follow-up read-only diagnosis found this Mac's Tailscale backend stopped, no active
private IP and PBX traffic routed through ordinary Wi-Fi. The saved profile remains
signed in. Reconnecting it with unchanged settings is proposed, pending approval
because it activates saved DNS/private routes. PBX health and 7001 remain unverified.

## Ordered remaining gates

| Gate | State | Required evidence |
|---|---|---|
| 2 — Full regression | COMPLETE | 664 passed, 1 optional live-model test skipped; both typechecks and production build passed |
| 3 — RISK-001 | COMPLETE | Reproduced/fixed races; revisions and shared SQLite claims; stale UI/voice references, two processes, migration and recovery tests |
| 4 — Real Google | COMPLETE | Real availability/create/two reschedules/cancel/cleanup; same ID, exact local time, stale rejection, 15 existing events unchanged |
| 5 — ACCEPT-001 | BLOCKED | Local Tailscale stopped; approved reconnect pending, then read-only PBX/7001 diagnosis, approved isolated route and real human call |
| 6 — Deployment/restore | TODO | Target configuration, durable backups and a demonstrated restore before pilot onboarding |

7001 remains rolled back. No Asterisk, Telnyx, ARI, RTP, live server or phone-route
changes are authorized by this integration. Approval is needed before changing a
working route or merging main. A real Google test must use an explicitly isolated
test calendar and synthetic labels; never substitute a mocked result for it.

## Known limitations carried into later gates

- Shared-database writers must upgrade together. A crashed writer leaves its
  location blocked until an operator reconciles the outcome and clears that exact
  claim. Google/local writes are not one transaction; uncertain outcomes still need
  inspection. Legacy HTTP clients without `If-Match` cannot detect stale user intent.
- Office open-slot lists obey configured result limits; month/week views are not
  an exhaustive inventory of every free interval. Per-professional availability
  and Product date/time search remain available.
- Office quick booking acts on slot selection after a customer is chosen. Review
  this interaction with the office user during pilot acceptance.
- `staffOverrideAllowed` is stored metadata, without an implemented policy bypass.
  `afterHoursBehavior` guides the prompt rather than enforcing a domain boundary.
  Same-day booking is enforced at create time, not throughout all availability and
  reschedule paths. Do not advertise these as broader guarantees.
- Real email delivery, target-account OAuth, natural speech/microphone behavior and
  PBX routing require the later live gates; readiness metadata is not acceptance.
