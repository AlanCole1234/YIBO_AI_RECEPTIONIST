# AWS access and cost review — 23 October 2026

## Current state

The owner reports an active **Free plan and $100 credit balance**. Read-only Safari
inspection confirmed the new AWS experience, project **Happy Path**, region
**us-east-2 (Ohio)**, **183 days remaining**, and a registered Builder ID MFA device.
The Builder ID uses GitHub sign-in. The credit balance has not been API-verified.
The official **AWS CLI 2.38.5** is now installed for the Mac user only, under
`~/.local/share/aws-cli`, with a binary at `~/.local/bin/aws`. The vendor installer
verified the macOS package signature; `aws --version` and local login help passed.
No AWS login has been authorized and no AWS config/credentials file exists yet.
No AWS resources, IAM identities, policies, access keys, DNS records or plan changes
were created. The reviewed integration branch remains
`codex/launch-integration-reviewed`.

## Account-specific access plan — authorization pending

The earlier root/IAM-console-user proposal does **not** apply to this account.
In the new AWS experience, Builder ID owns the project; there is no root user.
Human project access is administrator access, and custom IAM users/roles support
programmatic access only. AWS already manages Organizations/Identity Center for
this experience. That automatic setup does not itself mean the Free plan was
upgraded. Do not activate advanced features or change the account plan for this
connection. The designated project region is Ohio, not the earlier N. Virginia
planning assumption.
[AWS account and access comparison](https://docs.aws.amazon.com/accounts/latest/reference/sign-up-for-aws.html).

Next connection step, requiring the owner to review and approve AWS authorization:

1. Use a separate local `yibo-audit` profile with region `us-east-2` and browser-based
   `aws login`. The user must review the selected project and consent screen.
   **The resulting CLI session inherits project permissions; naming a profile
   "audit" does not make it read-only.** Explain that administrator capability
   before authorization. No long-lived access key is needed.
2. After approval, verify the session identity without printing credentials, then
   perform only the agreed inventory reads. No resource creation, IAM change,
   plan upgrade or deployment is authorized. Keep approval controls enabled and
   credentials outside the repository. Use `aws logout --profile yibo-audit` when
   finished; AWS documents temporary credential refresh for up to 12 hours.
3. If adding AWS MCP later, use the SigV4 proxy with `--read-only`, only the
   `yibo-audit` profile allowed, and `AWS_REGION=us-east-2` operation metadata.
   The MCP endpoint can be in `us-east-1` while operations target Ohio. Read-only
   mode filters tools; it does **not** reduce the underlying CLI/IAM permissions.
   No MCP server, toolkit rules, or automatic approval setting has been installed.
4. The existing `deploy/aws/codex-audit-policy.example.json` remains an **unapplied
   inventory allowlist**. It is not a restriction on an administrator session.
   Any enforceable restricted-role setup requires separate review of the actual
   managed project policies and explicit approval before IAM changes.

AWS documentation: [temporary local login](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html),
[official CLI installation](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html),
[MCP connection options](https://docs.aws.amazon.com/agent-toolkit/latest/userguide/getting-started-aws-mcp-server.html),
[proxy read-only mode](https://github.com/aws/mcp-proxy-for-aws#configuration-parameters).

No suitable EC2/deployment plugin was found in the available plugin directory;
the available AWS analytics plugin does not serve this task. The CLI preparation
does not require installing the complete Agent Toolkit or changing other tools.

## Preliminary hosting estimate

Historical assumptions: Linux in **us-east-1 (N. Virginia)**, 730 running hours/month, one
instance, 20 GiB total gp3 storage at baseline performance, one public IPv4,
existing DNS provider/domain, and low initial traffic. This is a planning estimate,
not an approved resource selection or an AWS account-specific quote. **The actual
project is in us-east-2 (Ohio); verify Ohio rates and eligibility before using this
table for approval.** No resources have been selected or launched.

| Component | x86 baseline | Conditional ARM trial |
| --- | ---: | ---: |
| 2 GiB EC2 | t3.small: about $15.26/month | t4g.small: $0 compute during eligible 750-hour trial |
| 20 GiB gp3 | about $1.60/month | about $1.60/month |
| One public IPv4 | about $3.65/month | about $3.65/month |
| Base subtotal | about **$20.51/month** | about **$5.25/month** during trial |
| Initial allowance for small backups/monitoring/requests | $1–3/month planning reserve | $1–3/month planning reserve |
| Initial planning range | **$22–24/month** | **$6–8/month**, trial only |

Arithmetic uses AWS's current T3 product table ($0.0209/hour), gp3 storage planning
rate ($0.08/GiB-month), and public IPv4 ($0.005/hour). Confirm actual selected-region
rates and eligible discounts in AWS before launching. The reserve is our allowance,
not a quoted bundle or spending cap; storage churn, logs and transfer can exceed it.
[T3 rates](https://aws.amazon.com/ec2/instance-types/t3/),
[EBS pricing](https://aws.amazon.com/ebs/pricing/),
[IPv4 pricing](https://aws.amazon.com/vpc/pricing/).

AWS currently states that new/existing customers receive **750 aggregate monthly
t4g.small hours until December 31, 2026 (UTC)** in eligible regions, including
N. Virginia. Only compute is covered; surplus CPU credits and other resources
remain separate. Verify the offer on this account and run Linux ARM validation
before selecting it. Its post-trial compute rate is **not yet verified here** and
must be included in the 183-day forecast before approval.
[T4g trial terms](https://aws.amazon.com/ec2/faqs/).

The x86 planning range uses $100 in roughly **4.2–4.5 months**, shorter than the
reported 183-day limit. The conditional ARM trial may extend that runway, but it
does not make the entire system free. Eligible usage can consume credits while
the Free plan remains active; do not upgrade it to continue automatically when
credits or time run out. AWS documents loss of access at Free-plan expiry.
[Account-plan limits](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html).

These totals exclude domain registration, taxes, excess traffic/logs/backups and
burstable-CPU surcharges. Use Standard CPU-credit mode for the initial synthetic
evaluation to avoid surplus CPU charges, then evaluate throttling before voice
production. Do not silently trade real-call quality for a lower estimate. Existing
DigitalOcean, Telnyx and direct OpenAI costs are separate and not paid by AWS credits.
No NAT gateway, load balancer, managed database, reserved commitment or Spot instance
is proposed. Budget alerts should precede resource launch; they do not cap usage.

## Next gates

1. Sign-in type and project region are identified; the local CLI is installed.
   The Mac subsequently locked, so browser authorization remains pending. Have
   the owner unlock it and review the exact CLI consent before granting access.
2. Verify regional availability/account limits, the ARM trial and post-trial rate;
   obtain the approved domain and produce the final resource/cost proposal.
3. Obtain explicit approval for infrastructure, then start with synthetic data.
   Existing hosted OAuth, Voice Lab, backup and real-call gates remain in
   [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md). No production deployment is authorized.
