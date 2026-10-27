<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-93m.1 contract interpretations

1. **Task: `{ ok, granted }` result.** Options: `granted` is a boolean, or it
   contains the returned grant records. Conservative reading: a boolean that is
   true only when `ok === true` and the extension returns at least one grant.
   Empty grants and failed replies never signal approval.
2. **Task: mode validation and unchanged request forwarding.** Options: translate
   ACL IRIs into short modes, or preserve the supplied request. The inspected
   extension's `src/background/core/class-grant.ts` accepts only `read`, `append`,
   and `write` (case-insensitive, trimmed); full ACL IRIs currently fail its parser.
   Conservative reading: accept those short forms and their exact full
   `http://www.w3.org/ns/auth/acl#Read`, `#Append`, and `#Write` counterparts as
   required by the brief, forward unchanged, and recommend short modes for this
   extension version. Reject `Control`, compact prefixed names, and unknown modes.
   Extension-side IRI support remains outside this lane.
3. **Task: optional duration versus extension documentation.** Options: require a
   duration here, or forward it as optional. Follow the brief's optional signature
   unchanged; the extension enforces its positive ISO-8601 duration requirement.
