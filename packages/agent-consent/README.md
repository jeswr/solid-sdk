<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->
# @jeswr/agent-consent

Browser-safe consent core for a consumer agent (security-critical, private).

- `evaluateAction`: the outbound gate. It runs mandate, recipient, disclosure, data terms,
  limits and approval, and evidence, and returns go, ask or stop.
- `buildApprovalRequest` / `checkResponse`: the dynamic approval sheet. The gate writes the
  title, facts and offered responses. Responses carry the displayed `requestId` and `digest`;
  mismatches and responses that were not offered are refused. The caller accepts each request once.
- Spending rules (`checkSpend`, `ruleUsage`) come in three kinds: per purchase, a weekly or
  monthly budget (UTC), and an allowance. The most specific covering rule wins. Money is
  kept in integer minor units. Raised rules retain every previous rule ID in `supersedes` and
  preserve the original `createdAt`, so budget usage and allowance lifetimes continue across raises.
- Device-signed records (`signRecord` / `verifyRecord`): compact JWS ES256 over RFC 8785
  canonical JSON, signed with a non-extractable WebCrypto key. There are three record
  types: approvals (single use, bound to the action digest, 10-minute TTL), spending rules
  and revocations.

The gate is pure. Callers verify consent and attestation signatures and validity windows on
each use, serialize decisions with execution and accounting, and consume one-time authority
before effects. An exact approval can permit one interaction with an unestablished recipient;
it does not establish trust or grant standing permission.

Tests keep 100% line, branch, function and statement coverage per file.
