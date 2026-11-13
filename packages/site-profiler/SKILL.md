---
name: site-profiler
description: Use when changing @jeswr/site-profiler, the semantic agent browser's profiler that crawls a site, analyses its forms and scripts, runs demonstrations and writes a SiteModel.
---
<!-- AUTHORED-BY Codex GPT-6 -->

<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/site-profiler

Read README.md first. The output contract is `packages/site-model/src/types.ts`; never change it
from here, and keep the profiler returning a `SiteModel` object (the site-model package owns RDF).

Invariants the tests keep:

- The recorder's route guard aborts every non-GET request outside the `login` and
  `demonstration` phases. The crawler only navigates. Probes and verification send GET only.
  `test/e2e.test.ts` checks the shop's request log for this; keep that assertion.
- Writes enter the model only from demonstrations; the login operation is the single exception.
- The trace never holds cookie values, authorization headers, passwords or CSRF tokens.
  `sanitiseHeaders` and `redactBody` own that.
- Third-party text (descriptions, reviews, authors) is extracted with `untrusted: true`.
- Retain demonstrated Order/Invoice/totalPaymentDue reads after the last write before payment,
  even when no wire binding consumes their amount. Prefer the JSON total object over nested lines.
- Failed probes supply no parameter examples. Probe search fields with the crawl word; skip other
  required query values when no endpoint-specific value is known.
- Verify with complete recorded 2xx request values matching the operation's own method, origin,
  path and fixed query; prefer demonstrations, then crawl, and retry a failure once with recorded
  successful values. Total reads and payment share delivery defaults/options through their flow input.
- Generated selectors stay inside the subset `html.ts` implements.

Tests use only 127.0.0.1: `@jeswr/test-shop` and small fixtures in the test files. Playwright
launches through `launchChromium` (`SAB_CHROMIUM_PATH` overrides the browser). Run
`pnpm --filter @jeswr/site-profiler run test`; never leave `coverage/` behind.
