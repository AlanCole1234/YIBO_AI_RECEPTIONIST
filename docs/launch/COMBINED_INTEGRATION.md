# Combined launch integration — 23 October 2026

Status: validated locally with synthetic data; **not deployed or approved for
production**. AWS is now the owner's deployment target. Earlier Cloudflare plans
remain historical evidence, not instructions to change that deployment.

## Preserved sources

- Integration branch: `codex/launch-integration-reviewed`.
- First parent: `701d4348622fad4faec301098d22c3d707df80c1`, containing David's
  booking/product/office work and the verified stale-compensation fix.
- Second parent: `c64226966f93068303da15655a1596b0300d88b3`, the reviewed PR #3
  launch work, including the process-lock, snapshot and DST corrections described
  in [the intake review](CODEX_REVIEW.md).
- GitHub `origin/main` remains `01dc29a7fc2385126dc88018d4e213099480696f`.
  The local `main` ref is still the older `7df03e4`; neither ref was changed.
  Neither original PR #19 nor PR #20 was merged into main or rewritten.
- Existing phone playback fix `8db12d1` is still separate. Review it against this
  candidate before a phone cutover; this checkpoint does not replace the working
  phone runtime or copy any Asterisk template onto the PBX.

The only textual merge conflicts were the prompt compiler and its tests. The
resolution retains price-disclosure restrictions, location/locale/readback rules,
backend confirmation and timestamp guidance, alongside AI disclosure and the
launch safety rules. A new regression checks these rules together. Automatically
merged startup keeps booking recovery and adds the optional single-instance lock.
The existing modern dashboard and office/customer/notification modules remain.

For production backups, retain the regional `database-backup` CLI and
`deploy/backup/` workflow. The additional `db:snapshot` command is a low-level,
single-file utility, not a replacement for regional backup/restore verification.

## Automated validation

- Focused merge suite: **77/77** across nine files (prompt compiler, configuration,
  scheduling, stale compensation, instance lock, snapshot, office integration,
  ARI client and telephony gateway).
- Full suite: **773 passed, 1 optional live OpenAI test skipped**; 106 passing test
  files and one skipped file. Rerun on 23 October before the checkpoint commit.
- Backend TypeScript, frontend Vue TypeScript and production Vite build: passed.
- Asterisk template validator and cost-model command: passed. These validate
  repository templates/assumptions, not the installed PBX or actual provider bills.
- Frozen dependencies unchanged. Provider secrets were excluded from test
  environments. No live provider writes, real customer data or recordings used.

## Browser acceptance and limits

The actual merged Vue UI used a loopback Fastify API, disposable synthetic SQLite,
an in-memory Calendar and a simulated Voice Lab WebSocket. No live provider was
connected. Checks performed on 20 October and completed on 23 October:

| Area | Result |
| --- | --- |
| Owner login and reload | PASS; authenticated UI/session persists |
| Booking and professional | PASS; Office creates one confirmed appointment for Dr. Alex; product calendar shows the same appointment |
| Rescheduling | PASS; Office changes the time, product calendar moves it again to the next day |
| Cancellation/history | PASS; cancelled state, mutation controls removed, customer history and office timeline agree |
| Notifications | PASS for disabled-provider path: records show SKIPPED; real email delivery untested |
| Settings | PASS; price restriction, digit readback and location locale persist after reload |
| Compact layouts | PASS at 390 px for settings, catalog, calendar mappings and appointments; no horizontal overflow |
| Roles | PASS; secretary has office booking controls without admin settings; read-only sees disabled slots and no create-customer control. Server authorization/isolation also covered by suite |
| Voice Lab | PASS with simulated provider: actual WAV file picker/upload, playback idle acknowledgement, interruption/clear acknowledgement, manual close and socket cleanup |
| Fresh Voice Lab session | PASS; counters reset, automatic completion occurs once, duplicate close and late usage are ignored; both sockets disconnect |
| Usage display | PASS; first synthetic session $0.013128, second < US$0.0001 and 10 text tokens; recent activity distinguishes tests 1 and 2 |

The temporary fixture was recreated on 23 October after its earlier temporary
database/process disappeared. Earlier browser appointment checks were not claimed
to have survived that reset. Prepared-agent rules were separately verified on the
new synthetic fixture (es-MX override, price disabled, digit readback, AI disclosure
and successful-tool confirmation). The fixture and synthetic login data are ignored
local files, not product changes.

These results do not prove live speech quality, real microphone permissions,
Google/OAuth readiness, email delivery, AWS Linux reboot/backup recovery, or a
successful public phone call. Docker is unavailable locally; no image was run.

## Remaining release gates

1. Create the AWS account, verify its actual plan/credits/expiry and choose an
   approved hostname and cost envelope before provisioning. See the subsequent
   AWS deployment checkpoint; no resource or infrastructure change is authorized
   by this integration merge.
2. Hosted Google OAuth callback currently validates return URLs as HTTP localhost
   with a port. An HTTPS dashboard return URL fails that validation. Prepare a
   narrow trusted-origin fix and tests before hosted reauthorization; do not relax
   it to arbitrary URLs or change live credentials as part of this checkpoint.
3. The development Voice Lab still uses a private, separate port. Do not expose
   that harness publicly. Hosted authenticated WSS requires a separate review.
4. Verify one authoritative database/phone owner, backup restore, Linux persistence,
   monitoring, Google create/move/delete and an actual phone conversation before
   inviting paying customers. Existing Asterisk routing remains untouched.
