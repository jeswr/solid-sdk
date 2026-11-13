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

Administrative applications:
- Inspect the redirected start page for a password form before navigating elsewhere. Preserve
  application base paths in fallbacks, bracketed credential wire names and path-scoped cookies.
- Keep navigation, post-render idle and full-profile deadlines bounded. Page attempts include
  failed navigations. Prioritize navigation-menu anchors; never click unknown action buttons.
- Dispatch query selectors partition resources. Preserve encoded bracket names for paging,
  sorting and filters; observed defaults belong to that resource only. Inferred filter members
  require a witnessed filter prefix and the request's own referring page.
- Session URL material needs both repetition and a page/cookie source. It never becomes an
  input/example/default. The executor owns path-token decoration; shared contract types stay unchanged.
- Script syntax/size failures produce one summary, not a warning per vendor bundle. Try script
  before module; skip truncated source. Preserve XHR headers during verification, and never treat
  an HTTP 200 password form or redirect/error JSON as successful data.
- JSON unknown scalar properties use stable keyed sab IRIs; unknown text is untrusted, secrets
  and nested objects are excluded. Order status is contextual, not inferred from product status.
- Keep every new heuristic covered by small fixtures. `test/generic.test.ts` covers pure inference;
  `test/generic-browser.test.ts` covers actual login/menu/idle/deadline behavior. The explicitly
  authorized disposable live fixture is opt-in via SAB_LIVE_SITE_URL in webarena-bench; the default
  suite remains deterministic and local. Never run a planner as part of live profiling acceptance.

- Never emit executor-owned headers (including Accept and Content-Type) as model static headers,
  header parameters or CSRF header targets. Keep body encoding in request.contentType. Verification
  derives Accept from extraction format; recorded JSON Accept is not a model header. Vendor-specific
  Accept requires a future first-class, inventoried field.
