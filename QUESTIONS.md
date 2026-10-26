<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# SKL-02 scope interpretations

1. **Should the preserved reference-code snapshots also be rewritten?** Skills DESIGN §2
   D3 asks for Pitfalls entries or disposition; SKL-01 preserved the historical examples.
   Options: (a) document defects and limitations in Pitfalls, retaining snapshots as reading
   material; (b) rewrite and revalidate the reference implementations and their tests.
   Conservative choice taken: (a). The auth skill flags the unfixed defects explicitly;
   only its inline callback example and related narrative are corrected for consistency.

2. **Should source proposals be copied literally where they conflict with the current API
   or existing security guidance?** Skills DESIGN §2 D3 permits not-applicable dispositions.
   Options: (a) preserve the actionable lesson with explicit qualifications and record the
   rejected claim/workaround; (b) reproduce every proposed snippet and workaround verbatim.
   Conservative choice taken: (a), particularly for raw-Response nonce detection, public-write
   auth proof, audience/`htu` equality, broker consent fields, TLS and COOP workarounds.
   The disposition ledger records each qualification. No implementation decision is blocked.
