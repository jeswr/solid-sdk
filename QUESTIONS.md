<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# T-072 / sst-8xm.60 — architecture questions

Implementation stopped under the lane brief's ambiguity rule. No package files
have changed.

1. **What compatibility condition should enable the WASM policy switch?**
   ADR-007 D1 requires delegation to solid-odrl now and feature-detected delegation
   to `policyEvaluate` later, behind the same signature. D2 accepts `purpose` and
   injected `now`; the acceptance criterion requires solid-odrl decision parity.
   ADR-008 A7 explicitly leaves the policy JS contract subject to sparq #1974.

   The pinned npm 0.1.5 binding has no `policyEvaluate`. The available upstream
   source (`crates/sparq-wasm/src/policy.rs`, inspected locally) labels its export
   an experimental probe awaiting a public-contract decision. It is a module-level
   function with signature
   `policyEvaluate(policyRdf, format, actionIri, target?, party?)`, returning JSON
   `{ allow, matchedRules, unmetConstraints }`. It accepts neither `purpose` nor
   request time. Its tests deny a conflicting policy with `odrl:perm`, whereas
   solid-odrl's characterization corpus permits that case. Presence detection
   alone therefore cannot guarantee the requested stable semantics.

   Options:
   - Keep solid-odrl authoritative until an approved, compatible WASM contract
     exists; detect the probe but do not select it merely because it exists.
   - Approve a restricted WASM dispatch condition and adapter, specifying which
     contexts/policies remain on solid-odrl and how parity is established.
   - Amend the facade/acceptance criteria to adopt the probe's supported context
     and evaluation semantics.

2. **What is the exact solid-odrl projection to `matched` and `unmet`?**
   ADR-007 D2 defines `{ allow: boolean; matched: string[]; unmet: string[] }`
   without defining the strings. solid-odrl returns matched permission and
   prohibition traces with optional rule IDs, active duties with optional IDs,
   and a decision/reason. Its default evaluation permits with advisory
   unfulfilled duties; it does not return a list of unmet constraints.

   Options:
   - Use identified matched rule IDs and unfulfilled duty IDs/actions, keeping
     solid-odrl's advisory-duty decision. Specify how anonymous rules are named
     and whether failed constraints need additional explanations.
   - Specify another projection, including whether unfulfilled duties change
     `allow` and how no-policy/not-applicable outcomes populate `unmet`.

The remaining deriveForm and benchmark work is unstarted because the brief
requires ending the lane when an ADR ambiguity is encountered.
