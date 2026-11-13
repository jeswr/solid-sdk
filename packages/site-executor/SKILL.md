---
name: site-executor
description: Use when working on @jeswr/site-executor, the semantic agent browser's executor that compiles an RDF action request into a site's own HTTP calls behind an approval gate.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/site-executor

Read README.md first. Private, security-critical package: it holds user sessions and makes HTTP
requests. Contract types come from `@jeswr/site-model` (`src/types.ts`); do not redefine them here.

Keep these invariants, and add an adversarial test for any change that touches them:
- `origin.ts` `guardUrl` runs on every URL before it is requested: operation URLs, CSRF pages and
  redirect targets. It compares the WHATWG-parsed origin, and http is allowed on loopback only.
  Never use `redirect: "follow"`.
- Nothing is sent before the gate allows it. Approvals are single-use and bound to
  `approvalDigest`, and the executor (not the gate) decides whether an approval id matches.
- Results and errors carry no cookies, session headers, CSRF tokens, query strings or response
  bodies. Extracted text goes through the redactor.
- Values reach requests structurally (RFC 6570 encoding, JSON values, form fields), never by
  splicing into raw text. Model headers cannot set credentials or framing.
- Untrusted fields are emitted only as `sab:UntrustedText` nodes. RDF output uses `n3.Writer`.

Tests use only their own 127.0.0.1 servers (`test/fixture-shop.ts`, `test/helpers.ts`) and fictional
data. Never contact a real site.
