# Phone development preservation checkpoint — October 4, 2026

## Scope

This checkpoint preserves the previously uncommitted work in the root checkout on
`codex/asterisk-development-phone`, based on `447c667`. It is a source backup, not
a deployment or a replacement for the newer launch-candidate/integration branches.
The other worktrees and their existing changes remain separate.

Preserved work includes:

- Exact-slot booking consent, one successful-booking confirmation using the booked
  clinic-local time, and rejection of stale or reused confirmation.
- Realtime turn handling, tool deadlines and deduplication, playback completion,
  a single final goodbye, and call/session cleanup.
- Google event identity checks, in-place rescheduling, conditional updates/deletes,
  and regression coverage for collisions and repeated appointment changes.
- ARI and RTP adapters, telephone audio conversion/pacing, and development-only
  audio diagnostics controlled by the existing environment settings.
- Voice Lab playback acknowledgments, agent patience controls, focused regression
  tests, and the dated investigation notes explaining the earlier work.

## Verification

The first offline run found one stale test expectation: the session tool list did
not include the internal `end_call` tool already implemented by the preserved
call-completion work. The expectation now requires both `check_availability` and
`end_call`. A synthetic ARI event also used a real private-network address; the
fixture now uses a documentation-only address. No runtime implementation was
changed for this checkpoint.

- Final offline suite: **558 tests passed in 38 files**.
- Command: `./node_modules/.bin/vitest run --dir tests --exclude '**/*.live.test.ts' --maxWorkers 2 --minWorkers 1`.
- Backend and frontend typechecks and the Vite production build: **passed** via
  `pnpm build`.
- `git diff --check`: **passed**.

Tests used synthetic provider responses, disposable database paths and loopback
UDP/WebSocket sockets. Provider credentials were removed from the test process;
the optional live Realtime test was excluded. No real call, Calendar operation,
remote service restart, routing change, deployment or production-data write was
performed. The earlier dated reports retain their original results and limits;
they are not claims of fresh live acceptance.

## Publication boundaries

Source, tests, the explicit opt-in diagnostic script, and text reports were reviewed
for credential literals and sensitive files. Test credential values are synthetic.
Real `.env` files, SQLite databases, recordings and generated build output are not
part of the checkpoint.

The following existing work remains unchanged locally and is intentionally not
included in the commit:

- `.env.example` modifications containing private network endpoint configuration.
- The six `docs/reliability/live-confirmation-*.json` provider trace/result files.
- All separate Cloudflare-deployment worktree drafts.

The current launch candidate remains on its own branch. No merge to `main`, phone
deployment, Cloudflare activation or production readiness claim is included.
