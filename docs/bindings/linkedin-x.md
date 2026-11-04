<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# LinkedIn and X read limits (A-035 / sst-n77)

## LinkedIn: notification email proxy only

There is no sanctioned general personal LinkedIn messaging API path for this
integration. LinkedIn's [API access catalogue](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access)
does not offer self-service personal inbox access. Restricted partner APIs do not
grant this agent access. This binding does not scrape LinkedIn, automate its UI,
reuse browser cookies, or contact unofficial messaging endpoints. It has no
LinkedIn credentials, network origins, or send implementation.

The existing Gmail reader runs `triageLinkedInNotification` after MIME inspection.
Email from the exact, case-insensitive mailboxes `messages-noreply@linkedin.com`,
`notifications-noreply@linkedin.com`, `updates-noreply@linkedin.com`, or
`invitations@linkedin.com` gets `BridgeMessage.channel = "linkedin-proxy"`.
Other mailboxes, subdomains, lookalike domains, display names and subject mentions
do not match. The helper is also exported from `@jeswr/agent-channels/gmail`.
This is local triage of ingested mail, not a Gmail label mutation.

The proxy preserves the email's sender, body, IDs, claims, raw digest and size;
it adds `linkedin-proxy-unverified` to the warnings. From and DKIM claims remain
unverified: the tag is a routing hint, not evidence of LinkedIn identity or a
member's identity. Notifications can be delayed, truncated or absent and do not
reconstruct a complete LinkedIn inbox. The proxy grants no reply authority.
Review the notification and use LinkedIn manually for any reply; do not treat
its From or Reply-To address as a member's messaging endpoint. Existing Gmail
send approval requirements still apply to any separately proposed email action.

## X: optional, read-only and budgeted

`@jeswr/agent-channels/x` exports `createXReader`, `createXSpendCounter`,
`X_READ_SCOPES`, and `ORIGINS`. It is disabled unless `enabled: true` is supplied.
Its descriptor has `sendSupported: false`, a zero-byte send carriage and no send
subpath. Nothing here can post, reply, delete or send DMs.

The credential provider must obtain an OAuth 2 user grant with
[authorization code and PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
(S256, random state and exact callback validation). Request the exported read
scopes `dm.read`, `tweet.read`, and `users.read`; never `dm.write`. OAuth setup,
refresh and credential storage belong to the credentials layer. The reader only
calls `TokenProvider.read(account)`; its grant type separates read from send but
does not attest the original OAuth flow or inspect provider token scopes.

After the owner approves developer access and the cost budget, compose it as:

```ts
import { createXReader, createXSpendCounter } from "@jeswr/agent-channels/x";

const spend = createXSpendCounter({
  cap: 1000,
  costPerCall: 100,
  periodMs: 24 * 60 * 60 * 1000,
});
const reader = createXReader({ enabled: true, tokens, spend });
```

The numbers are illustrative accounting units, not X prices. Configure
`costPerCall` as a conservative upper bound on the provider charge for a page
of up to 100 events, in the same integer units as `cap`. Recheck the developer
project's current terms before enabling it; if a reliable bound is unavailable,
leave X disabled or use a zero cap. The counter caps configured reservations,
not the provider's independently calculated invoice.

Reservations are synchronous, before credential acquisition or network access,
so concurrent attempts cannot overshoot the cap. The example permits ten
attempts in a fixed UTC day and refuses the eleventh before credentials or I/O.
Errors, redirects, timeouts, malformed responses and byte-bound refusals keep
their reservation; there are no automatic retries or refunds. A later UTC
period replenishes the counter; a backward clock does not. Share one counter
across accounts and readers using the same budget.

The counter is process-local and has no manual reset. Keep it alive for the
whole accounting period. Creating another counter or restarting the process
starts a fresh budget; this module is not a durable or cross-process billing
ledger. A deployment requiring that guarantee must keep X disabled until its
host supplies durable budget accounting through the `XSpendCounter` seam.

Reads use only guarded `GET https://api.x.com/2/dm_events`, with redirect refusal
and DNS pinning. The [DM lookup API](https://docs.x.com/x-api/direct-messages/get-dm-events)
provides bounded pages; the [lookup overview](https://docs.x.com/x-api/direct-messages/lookup/introduction)
documents a 30-day history window. The binding requests only message events and
does not retrieve attachments or follow links. Account-scoped cursors carry the
provider page token. At the end of pagination a subsequent call polls the latest
page; callers deduplicate stable event IDs. A page exceeding aggregate byte
bounds fails without returning an advanced cursor, so retry the previous cursor
with an adequate bound. Parsed content and sender identifiers remain untrusted.

All regression tests use recorded synthetic fixtures and injected transports;
they never authenticate with or contact Gmail, LinkedIn or X.
