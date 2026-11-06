# AWS staging hostname — completed 5 November 2026

The existing synthetic YIBO staging application is available at
**https://staging.getyibo.com**. The owner purchased `getyibo.com` separately
and explicitly approved this one DNS record, staging HTTPS/origin change,
configuration backup and staging-only API restart/Caddy reload.

## Changes applied

| Setting | Verified value |
| --- | --- |
| Porkbun DNS | A `staging.getyibo.com` → `3.134.168.191`, TTL 600 |
| Existing AWS host | Ohio Lightsail `yibo-staging`; attached IP unchanged |
| `YIBO_PUBLIC_HOSTNAME` | `staging.getyibo.com` |
| `YIBO_DASHBOARD_ORIGIN` | `https://staging.getyibo.com` |
| Running application release | `282f5c777d5780a66d9cccd36a3f908468d21fe0`, unchanged |
| API upstream | Existing loopback `127.0.0.1:3000` |
| Existing IP URL | Trusted HTTPS 308 redirect to the staging hostname |

The seven existing DNS records were preserved, including root/wildcard parking,
MX, SPF and registrar challenge records. The saved zone has eight records.
No root-domain website, email service or nameserver was changed. AWS continues
to host the application; no Cloudflare application deployment was involved.

Before activation, original files and their ownership/modes were preserved in
the root-only directory `/etc/yibo/rollback/domain-20261105T044016Z`:

- `public.env` from `/etc/yibo/public.env`;
- `yibo-staging.Caddyfile` from `/etc/caddy/yibo-staging.Caddyfile`;
- separately validated `.candidate` copies of both files.

Only the two public environment values above changed. The installed Caddy
wrapper retains the existing ACME issuer, short-lived profile and immutable
`/opt/yibo/current/deploy/aws/Caddyfile.example` import. It keeps
`default_sni 3.134.168.191` for existing IP clients and adds an HTTPS IP block
that returns 404 for `/voice`, `/voice/*`, `/ari`, `/ari/*`, then redirects other
requests to `https://staging.getyibo.com{uri}`. The imported hostname routes
retain the same dashboard assets, API proxy and private-path restrictions.

The staging guard and Caddy validation passed before activation. Only
`yibo-api.service` was restarted and `caddy.service` reloaded. Read-only follow-up
confirmed that installed files match the validated candidates and preserve
original ownership/modes, and the running API process has the new dashboard
origin. No application release, dependency, service unit, provider credential,
database schema or phone configuration was changed.

## Validation actually performed

| Check | Result |
| --- | --- |
| Authoritative/public DNS | A record resolves to the existing attached IP; no AAAA or CNAME at this hostname |
| Normal TLS trust and hostname validation | Pass; certificate SAN is `staging.getyibo.com` |
| Hostname dashboard and `/api/health` | 200 |
| Unauthenticated `/api/auth/me` | 401 |
| HTTP hostname | 308 to the same HTTPS hostname |
| Original HTTPS IP | 308 to the new HTTPS hostname |
| `/voice` and `/ari`, hostname and IP | 404 |
| Browser | New hostname renders the normal sign-in form without an authentication-unavailable error |
| Owner login | Owner reported successful sign-in at the new hostname on 5 November; password entered privately |
| Staging guard / Caddy validation | Pass on the existing host; synthetic-only restrictions remain enforced |
| API / Caddy / backup timer | Active and enabled at boot |
| Latest scheduled backup at follow-up | Success, exit 0, 5 November 16:02:12 UTC |
| Existing isolated-startup regression tests | 10/10 passed locally on Node 26.7.0 |

The owner-login result is a manual report, not an automated authenticated test:
the agent-controlled browser tab remained at sign-in. Prior authenticated
synthetic appointment/roles/persistence/restore evidence remains in
[the staging validation report](AWS_STAGING_VALIDATION.md); those scenarios
were not repeated during this hostname-only checkpoint.

The initial `pnpm exec` attempt could not fetch registry signature metadata for
the pinned pnpm version and stopped before running tests. The already installed
Vitest entry point then passed all ten cases without downloading dependencies,
changing the lockfile or disabling signature verification:
`node node_modules/vitest/vitest.mjs run tests/release/lightsail-staging.test.ts`.
This is not evidence of a changed or compromised dependency. Application
typechecks/build were not repeated because no application source, dependencies
or build configuration changed; their previous passing results remain dated
in the release-update and staging-validation reports.

The hostname certificate was issued 5 November 03:43:26 UTC and expires
**11 November 19:43:25 UTC**. Caddy manages renewal automatically. This verifies
initial hostname issuance; the earlier natural renewal evidence applies to the
IP certificate. Continue the existing expiry checks and investigate if fewer
than 48 hours remain without successful renewal. No forced renewal was used.

## Rollback and remaining gates

If rollback becomes necessary, first compare the live files with the recorded
candidates and stop if another operator has changed them. Restore only the two
original files from the directory above, preserving ownership/modes; validate
the restored Caddy configuration with the original public environment; restart
only the staging API and reload Caddy. Verify loopback/public health, auth and
private routes. Do not restore a database or change the release link. The DNS
record can remain while investigating; deleting or changing it is a separate
action. No rollback was required during this checkpoint.

The approved AWS resource base remains **$13/month**, with no new resources.
This is not a new billing/credit-usage measurement. The separately purchased
domain does not change the existing AWS hosting configuration.

Next: obtain approval for the already prepared
[synthetic release update](AWS_STAGING_RELEASE_UPDATE.md), which includes hosted
OAuth return-state support. Then review a separate staging-only Google provider
configuration and authorization procedure using the owned hostname. Neither
Google settings/grants nor real providers were enabled here. Hosted Voice Lab,
private phone handover and real-business launch remain separate release gates.
