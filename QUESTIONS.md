<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-age2 interpretation questions

1. DRV-L1 requests `owner`, while 00-sdk-assumptions §5/A-11 calls the editable Control role
   `manager` and 02-suite-shell §6 pins an immutable Owner row. Options: rename the brief's role,
   infer legal ownership, or expose `owner` as a permission summary. Conservative reading: keep
   the requested `owner` label for full resource + policy control; it does not assert legal
   ownership. Refuse changes to existing owner rows in the diff.
2. DRV-L1 separates `link` from `public`, but 02-suite-shell §6/A-11 maps anyone-with-the-link
   to anonymous public access. Options: invent a secret-link mechanism, conflate public and link,
   or require caller presentation context. Conservative reading: `link` describes the anonymous
   grant; `public` also reports anonymous Read (a link is not a security boundary). Authenticated
   agent grants, groups, conditions and privileges beyond the requested shape are explicitly
   rejected rather than silently converted into anonymous access or discarded.
3. DRV-L1 asks for a minimal authorization diff without specifying RDF patches or SDK operations
   (09-pure-libraries allows no SDK dependency). Options: rewrite the document, emit RDF patches,
   or emit scoped mode changes for an adapter. Conservative reading: return deterministic
   additions/removals of protocol authorization modes per principal/resource/source, retaining
   unchanged modes and refusing inherited edits; the future SDK adapter performs persistence.
4. 00-sdk-assumptions §5/A-11 defines commenter across two resources. Options: treat Append on
   the file as commenting, or require the comments container's effective document as input.
   Conservative reading: require the separate comments context to recognize/create commenter;
   never grant Append on the file as a substitute.
