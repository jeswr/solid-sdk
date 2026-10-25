<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# T-010 / sst-8xm.31 questions

1. What is the exact public definition of `ProbeResult`?

   ADR-002 §Public API uses `ProbeResult` in `DescriptionCache.get` and
   `DescriptionCache.set` (and in the future `deriveFeatures` signature), but
   supplies no declaration. §Resolution algorithm describes probe observations
   (`acceptPatch`, `acceptPost`, `wacAllow`, `aclLink`, `acpLink`, `allow`, and
   evidence), without specifying their TypeScript types, optionality, or evidence
   representation. No definition exists in the SDK core ADRs or this package's
   T-001 scaffold. T-010 requires all public interfaces verbatim and compiling.

   Options:

   - Supply the exact `ProbeResult` declaration in ADR-002, then implement it
     alongside the interfaces that reference it (preferred).
   - Explicitly authorize this lane to design `ProbeResult` from the probe
     algorithm, including field types, optionality, and evidence representation.
   - Amend T-010 to defer the interfaces referencing `ProbeResult` until the
     probe contract is specified; this changes the current acceptance scope.

   The lane is stopped under the brief's ambiguity rule. No placeholder type or
   runtime implementation has been introduced.
