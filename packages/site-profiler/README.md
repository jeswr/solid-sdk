<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/site-profiler

Part of the semantic agent browser. The profiler learns a website once and returns a
`SiteModel` (the contract in `@jeswr/site-model`): the actions the site offers as schema.org
action types, each mapped to the site's own HTTP calls, plus flows learned from demonstrations.
The planner then asks for actions in RDF and never reads the page.

```ts
import { profileSite } from "@jeswr/site-profiler";

const { model, trace, warnings } = await profileSite({
  startUrl: "https://shop.test/",
  login: { username: "alex@example.test", password: "..." }, // optional, user-authorised
  demonstrations: [{ name: "buy-product", run: async (page) => { /* Playwright steps */ } }],
});
```

Options: `startUrl`, `maxPages` (default 40), `login`, `demonstrations`, `labeller` (default
`heuristicLabeller`), `browser` (else headless Chromium is launched; `SAB_CHROMIUM_PATH`
overrides the executable), `now`, `modelId` (default `urn:sab:model:<host>`), `verify`
(default true), `version`.

## Steps (one module each)

| Step | Module | What it does |
| --- | --- | --- |
| Login | `login.ts` | Signs in through the password form, records the cookies the login set (HttpOnly first) and finds a probe URL that is 200 signed in and refused signed out. Bearer token endpoints in scripts give `refresh` info. |
| Crawl | `crawl.ts` | Breadth-first over same-origin links and GET forms (free text gets a word seen on the site). Skips logout/delete-like links and static files. |
| Guard and trace | `recorder.ts` | Records same-origin requests without cookies, authorization or credential-like body fields. Aborts every non-GET request outside the login and demonstrations. |
| Scripts | `scripts.ts` | acorn analysis of same-origin JS: `fetch`, fetch wrappers, `XMLHttpRequest`, axios, jQuery; URL patterns from literals and concatenation; CSRF headers read from `document.cookie` or a meta tag. |
| Templates | `templates.ts` | Clusters requests into RFC 6570 templates (numeric, uuid, sku-like and known-id path variables; query and body parameters) and merges crawl, form and script evidence. |
| Forms | `forms.ts` | Fields, select options, hidden fields; hidden csrf/token/authenticity fields become html CsrfRules. |
| Extraction | `extraction.ts` | JSON arrays (or one product-like object) and repeated HTML cards (link plus price) or product detail pages, mapped to schema.org by key name. Descriptions and reviews are `untrusted`. |
| Labelling | `labeller.ts` | `Labeller` seam with deterministic heuristics; unknown writes are `irreversible-write`. |
| Operations | `operations.ts` | Parameters mapped onto property paths of the action node, request template, CSRF, session. |
| Demonstrations | `demonstrations.ts` | Runs scripted sessions, turns their writes into operations and the session into a Flow with inferred bindings. |
| Verify | `verify.ts` | Replays each read (signed out, then signed in), preferring a successful recorded request to that operation's examples. Retries a failure once with recorded successful values before dropping the read. Sets `session` and provenance counters; never replays a write. |

## The learning rule

Writes enter the model only from demonstrations (`provenance.method: "demonstration"`). Write
endpoints found in forms or scripts are reported in `warnings` and left out. The one exception is
the login operation: the password form the profiler submitted with the user's credentials
(`method: "form"`), and a token endpoint found in a script (`method: "js-analysis"`, lower
confidence), each referenced from a `LoginRoute`. Their username and password parameters have an
empty path, so only the credential vault can supply them.

Request examples stay with their endpoint; failed probes supply no parameter examples. Script
probes use the crawl word only for search fields and skip required query values they cannot infer.
Verification prefers successful demonstration requests, then crawl requests, keeping each request's
values together rather than mixing independent examples or defaults. Matching includes the method,
origin, path template and any fixed query values.

## Flow bindings

Every write of a demonstration is kept. For each value a kept step sent, the profiler looks for
the value on an earlier step's first extracted item (exact match first, then an IRI whose last
segment equals it). A write binds to the latest such step (the page the person acted on); a read
binds to the earliest (the shortest chain back to the inputs). Reads that supply a kept step are
kept too. Order/Invoice/totalPaymentDue reads demonstrated after the last write before payment
are also retained as money evidence, even when checkout sends no price. JSON totalPaymentDue
objects become Order extractions before considering nested product lines. Other values become flow inputs; a search query becomes `schema:object/schema:name`.
When a total read and payment share a delivery input, both bind to that input, which inherits the
payment form's default and options even when the read introduces it first.
Trivial values (`1`, `true`, ...) are never matched.

## Extraction selectors

Generated CSS selectors stay inside a small subset (type, `#id`, `.class`, `[attr]`,
`[attr="v"]`, `:scope`, descendant and child combinators) so any CSS engine reads them the same
way. `:scope` selects the item element itself (for `data-*` attributes on the card).

## Known limits

- Nested arrays in JSON (reviews of a product) are expressed as one field rule per index (up to
  five) because `FieldRule.path` is a single pointer.
- HTML prices without a numeric attribute are extracted as text.
- Path variables are only inferred for id-like segments; slugs need an id seen in a response.
