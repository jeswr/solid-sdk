<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# T-010 / sst-8xm.31 questions

1. What is the exact public definition of `ProbeResult`?

   ADR-002 §Public API uses `ProbeResult` in `DescriptionCache.get` and
   `DescriptionCache.set` (and in the future `deriveFeatures` signature), but
   supplies no declaration in its public API. §Resolution algorithm describes probe observations
   (`acceptPatch`, `acceptPost`, `wacAllow`, `aclLink`, `acpLink`, `allow`, and
   evidence), without specifying their TypeScript types, optionality, or evidence
   representation. The 2026-10-25 amendment now makes the declaration in the
   tracker's `lanes/brief-extras.json` normative, but the available file contains
   only T-001, T-002, and T-004 entries. It contains neither a T-010 entry nor
   `ProbeResult`. The generated `lanes/briefs/sst-8xm.31.md` likewise supplies
   no declaration. T-010 requires all public interfaces verbatim and compiling.

   Rechecked the relocated design sources in
   `/home/runner/work/solid-suite-planning/specs/sdk-core/` and tracker files in
   `/home/runner/work/solid-suite-tracker/lanes/`; the brief's original
   `/Users/jesght/...` paths are unavailable in this environment.

   Options:

   - Supply the exact `ProbeResult` declaration in the normative T-010 tracker
     extras (or directly in ADR-002), then implement it alongside the interfaces
     that reference it (preferred).
   - Explicitly authorize this lane to design `ProbeResult` from the probe
     algorithm, including field types, optionality, and evidence representation.
   - Amend T-010 to defer the interfaces referencing `ProbeResult` until the
     probe contract is specified; this changes the current acceptance scope.

   The lane is stopped under the brief's ambiguity rule. No placeholder type or
   runtime implementation has been introduced.
