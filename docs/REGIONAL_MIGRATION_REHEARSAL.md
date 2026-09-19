# REL-001 — regional migration rehearsal

Date: 2026-09-19. Code under test: `e6587e35fd8f805e6c127a113af0d39d615725cb`
on `codex/integrate-telephony-and-finish`. This was a rehearsal on copies, not a
production migration or release approval. No implementation changes were needed.

## Sources and preservation

Sources were the existing phone checkout's `data/yibo-mx.sqlite` and
`data/yibo-us.sqlite`, resolved against repository `.env`/process path overrides.
The US database was open by existing Node processes with a WAL; a read-only SQLite
online backup included committed WAL data without stopping those processes.
MX had no open handles or WAL; its cold copy was verified byte-for-byte against the
source with the no-WAL condition checked before and after. Ordinary read-only opening
of that WAL-mode MX file could not create the missing sidecars, so no source-side
journal initialization was attempted.

Private copies, manifests, checksums and execution scripts/results remain under
`/private/tmp/yibo-rel001-fcony_xw` (directory mode 0700; database copies mode 0600).
Backups were kept separate from mutable working copies. They are local temporary
artifacts, not a durable off-machine backup. No database, token, customer record,
call record or raw configuration was added to Git.

Both originals started at schema 4 and were still at schema 4 after the rehearsal.
Only the private working copies were migrated. Source processes were not restarted.

## Procedure and results

1. Checked baseline integrity and foreign keys: both clean.
2. Called the actual `openRegionalDatabase`, `migrateDatabase` and `seedBusiness`
   functions on explicitly guarded copy paths, using the committed regional fixtures.
   These are the functions used by `db:init`; original/default paths were not used.
3. Read existing agent configuration through `SqliteAgentConfigurationRepository`,
   exercising its real persisted upgrader. Validated stored business profiles through
   the current upgrader. Both copies reached SQL migrations 1–9.
4. Compared each existing row by primary key and every original column. No rows were
   missing. Existing values were unchanged except the expected agent-configuration
   JSON/timestamp upgrade. New location columns had no empty/null values.
5. Repeated migration, seed and agent reads: complete logical snapshots were identical
   to the first pass, including metadata. Integrity and foreign keys remained clean.
6. Ran `buildConfiguredApplication` against each copy with live-provider settings
   absent and no ARI enabled. Both prepared an agent successfully. MX received its
   initial v4 agent configuration; US retained one configuration upgraded to v4 with
   compatible tool additions. Rechecked preservation of all nonconfiguration rows.
7. Restored each untouched backup to another private file; complete logical SQLite
   dumps matched, and integrity checks passed. Original backup checksums were unchanged.

### Counts (before → after migration and offline bootstrap)

| Records | MX | US |
|---|---:|---:|
| Businesses | 1 → 1 | 1 → 1 |
| Called numbers | 1 → 1 | 1 → 1 |
| Customers | 0 → 0 | 0 → 0 |
| Appointments | 0 → 0 | 0 → 0 |
| Local calendar events | 0 → 0 | 0 → 0 |
| Calls | 0 → 0 | 102 → 102 |
| Call state transitions | 0 → 0 | 504 → 504 |
| Conversation usage | 0 → 0 | 387 → 387 |
| Encrypted Google token records | 0 → 0 | 1 → 1 |
| Agent configurations | 0 → 1 | 1 → 1 |
| Migration ledger entries | 4 → 9 | 4 → 9 |

Each copy contained one business in its expected region. New admin tables are empty;
a deployment using these copies would need admin provisioning before dashboard use.
No raw tenant/customer identifiers or credential contents appear in this report.

## Validation

- Full suite: **443 passed, 1 optional live test skipped** (72 passing test files).
- Backend `tsc --noEmit`: passed.
- Dashboard `vue-tsc --noEmit -p dashboard/tsconfig.json`: passed.
- Production Vite build: passed.
- Installed package binaries were invoked directly; this matches the repository
  package scripts without changing dependencies.

The full run includes synthetic SQLite migration/backfill and region/tenant/location
isolation tests, plus Google event identity and integrated voice-booking regressions.

## Remaining limits

These local databases contained no customers or appointments. Preservation of actual
appointment times, price snapshots or external event IDs could not be observed here;
those invariants have synthetic regression coverage only. This rehearsal cannot
establish the contents or compatibility of another host's deployment database.

Google token ciphertext was preserved, not decrypted or tested against Google.
No live carrier, PBX, OAuth, spoken conversation or transfer acceptance was performed.
The restored schema-4 backup was checked logically, not started under an older binary.
SQLite recovery does not undo external Google changes. Temporary private artifacts
must not be mistaken for long-term backup storage.

Next: REL-002 release-closure audit. Outstanding live acceptance and deployment limits
must remain explicit; this rehearsal alone does not close the roadmap.
