# AWS staging operations: observed health and approved alerts

Read-only follow-up: **30 October 2026, 00:54 UTC** (29 October in Denver).
Applies only to the existing synthetic Lightsail staging host and private bucket.
No new resources, alarms, subscriptions, provider credentials or service changes
were made during this audit.

## Observed health at the initial read-only audit

| Check | Observed result |
| --- | --- |
| Trusted HTTPS | Pass; dashboard and `/api/health` return 200 |
| Authentication boundary | Unauthenticated `/api/auth/me` returns 401 |
| Private routes | Public `/voice` and `/ari` return 404 |
| API / Caddy / backup timer | Active and enabled at boot; API/Caddy restart counters are zero since their current activation |
| Latest completed backup job | Success, 30 October 00:01:32 UTC |
| Actual encrypted remote repository | Readable using existing instance access; 25 regional snapshots; latest snapshot 00:01:30 UTC, about 53 minutes old at inspection |
| Capacity | 53.57 GiB free root disk, 1,440 MiB available memory; local snapshots/logs about 5.6 MiB |
| Bucket storage metric | Console reports 0.04 MB / 5 GB and 26 objects; this metric updates daily, so it is not a current per-object inventory |
| Caddy errors | 26 historical API connection-refused errors, last on 29 October at 03:13 UTC; none in the preceding six hours; no configuration change needed |
| Certificate | Initial issuance still served; valid until 4 November 17:52:47 UTC, about 137 hours remaining; natural renewal is not yet verified |
| AWS alarms / notification contacts | Both inventories empty in Ohio |
| Refreshed account console | Displays $100 credits and 177 Free-plan days, ending 23 April 2027; charges can post later |

The remote check listed snapshot metadata only. It did not restore over the live
staging database, prune backups, reveal the recovery key or inspect the owner's
Apple Note. The previously verified restore remains the restore evidence.

## Approved native Lightsail alarms — created 30 October

Use the existing Ohio instance and its existing private 5 GB backup bucket. Do
not create a CloudWatch custom metric, load balancer, extra server or SNS topic.
AWS states that Lightsail's monitoring/alerting feature has no additional charge;
use email only, avoiding possible carrier SMS charges. The approved base remains
$13/month, excluding existing tax/overage.
[AWS Lightsail monitoring FAQ](https://aws.amazon.com/lightsail/faq/).

| Alarm | Existing resource / metric | Saved trigger |
| --- | --- | --- |
| `yibo-staging-status` | Instance / `StatusCheckFailed` | Greater than 0, one five-minute period |
| `yibo-staging-cpu` | Instance / `CPUUtilization` | At least 80%, three consecutive five-minute periods |
| Bucket capacity (console-generated alarm name) | Existing bucket / `BucketSizeBytes` | At least 4 in the console's GB selector: 4,294,967,296 bytes (4 GiB); one daily data point in a 24-hour window |

The owner's explicit approval covered these three alerts and one email contact
in Ohio. AWS reports that contact as **Valid**, matching the approved recipient;
the owner confirmed the subscription privately. Its address and confirmation link
are intentionally omitted here. All alarms use Email and ALARM/OK notifications,
with no SMS, automatic restart, scaling, deletion or resource upgrade.

The bucket alarm was created through the console and preserved during the later
instance-alarm setup. Readback confirms its native daily setup: period 300,
288 evaluation periods, one data point to alarm, missing data `ignore`. The
CPU alarm uses three data points in three periods; status uses one in one;
both have period 300 and missing data `missing`. Instance resource identity,
synthetic-staging tag, verified recipient and absence of conflicting alarms
were checked before creation, followed by exact setting readback. No existing
alarm was overwritten.

**Notification test:** after both instance alarms evaluated to `OK`, one native
`test-alarm` request for `yibo-staging-status` in `ALARM` state returned
`TestAlarm Succeeded`, with `isTerminal: true`. Subsequent readback shows the
status alarm back in `OK`; CPU is also `OK`. No host outage or CPU load was
induced. The owner subsequently confirmed receiving the separate test email on
30 October. This verifies delivery for this controlled test, separately from
the earlier subscription confirmation; it is not a simulated server outage.
[AWS test-alarm behavior](https://docs.aws.amazon.com/cli/latest/reference/lightsail/test-alarm.html).

The bucket alarm is enabled but still `INSUFFICIENT_DATA`, awaiting its sparse
daily metric. Its threshold and delivery configuration are verified; a completed
metric evaluation is not. Do not report it as healthy or manufacture data to
clear that state.

The public staging checks were repeated on 30 October: trusted TLS, dashboard
and `/api/health` return 200; unauthenticated `/api/auth/me` returns 401;
`/voice` and `/ari` return 404. The initial certificate expiry is unchanged.
This checkpoint changes only approved AWS alarms/contact configuration and
documentation, so application tests, typechecks and build were not rerun.

The refreshed account console displays **$99 credits and 176 Free-plan days** on
30 October, with $1 posted usage. This is a delayed billing observation, not an
extra alarm charge or a forecast; the approved $13/month base is unchanged.
[Notification setup](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-adding-editing-notification-contacts.html),
[status alarm settings](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-configure-status-check-alarms.html),
[bucket alarms](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-adding-bucket-metric-alarms.html).

## Coverage limits and manual staging checks

Native alarms do **not** verify application login, HTTPS certificate expiry,
backup success/freshness, local disk/memory or recovery-key custody. Automatic
service restarts are recovery behavior, not an external uptime monitor. The
checks below remain operator tasks until separately tested alerting exists.

- **Daily:** verify the dashboard's trusted HTTPS and `/api/health`; investigate
  a missing/failed response. Do not bypass certificate warnings.
- **Daily:** inspect `systemctl show yibo-backup.service -p Result
  -p ExecMainStatus -p ExecMainExitTimestamp` and the active backup timer. Treat a
  failed job or no completed off-host snapshot within two hours as an issue.
  A zero exit code alone is insufficient if the recorded timestamp is stale.
- **Daily during this short staging trial:** inspect free disk and local backup
  growth, and the bucket's storage metric. At 80% use, investigate before
  approving more storage or a tested retention policy. Never silently prune.
- **Certificate:** observe a later trusted certificate with a changed serial
  and later validity dates. Investigate if less than 48 hours remain without
  renewal. Initial expiry is **4 November 2026, 17:52:47 UTC**. No forced renewal
  or certificate deletion was performed, and no background reminder was created.
- **Weekly:** review posted credits, transfer and bucket usage; the Free-plan
  deadline is separate from any later credit expiry. Do not upgrade the plan
  or add paid resources without approval.

## Separate release gates

Natural renewal, the bucket's first metric evaluation and the remaining
monitoring gaps must be explicit in any launch decision. Staging can continue
synthetic testing.
An owned business hostname, hosted OAuth return-state support, separately
approved real Calendar authorization, authenticated hosted Voice Lab and a
private phone handover remain separate. No DigitalOcean/Asterisk/7001 changes
or real-provider activation are authorized by this operations checkpoint.
