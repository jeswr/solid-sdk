<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-2qh interpretation questions

1. **Which vCard target should generic `contact:ContactPoint` match?**
   DECISIONS V10 / VOC-01 asks for vCard close matches on every contact class,
   but names no generic vCard channel class. Options: retain only its existing
   schema.org match, or add annotation-only matches to the existing vCard channel
   properties. Conservative choice implemented: reuse `vcard:hasEmail`,
   `vcard:hasTelephone`, `vcard:hasAddress`, `vcard:hasURL`, and
   `vcard:hasInstantMessage`, following the existing `OnlineHandle` precedent.
   No new class or entailment is introduced. Existing subclass/equivalence bridges
   are preserved; the missing explicit close matches are additive. This does not
   block the lane; the dispatcher may narrow this generic match later.
