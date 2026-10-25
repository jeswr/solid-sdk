<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# HM-00 questions

1. **Identity provenance resolution (03 §5.3, 08 model-first).** The three-argument
   provenance function needs the active WebID and resolved Client ID/profile names,
   but neither is available from an item's dataset. Options: fetch identities inside
   classification, or accept caller-resolved identity metadata. HM-00 takes the latter:
   an optional context supplies the user and an identity map; unresolved attribution
   falls through to the container rule. HM-01 can populate this map through its hooks.
2. **Discovery bounds (03 §5.1).** `integrations/**` has no traversal limit specified.
   Options: unbounded recursion, or a configurable request budget with an explicit
   incomplete result. HM-00 uses a default budget of 256 requests and reports
   truncation/partial failures. All authenticated reads stay in the selected storage;
   profile data can be supplied by the caller when its document is elsewhere.
3. **Collection documents (03 §5.1).** Connector collections contain multiple typed
   subjects, whereas the discovery paragraph specifies one primary subject per document.
   Options: expand all subjects, or follow that paragraph literally. HM-00 returns one
   primary item per resource (`#it`, `#this`, then most statements), with one additional
   aggregate profile contact-details card. Expanding connector collection documents is
   left for a spec clarification.
