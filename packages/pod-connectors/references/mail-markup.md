<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# Transactional email markup (CON-A8)

CON-A8 adds transactional schema.org email markup to `./mail`: `extractEmailMarkup`,
`createMailMarkupWriter`, `rescanMailMarkup` and their public types. Preserve the closed
schema/type/property allowlists and all byte, element, depth, node, script, string and item
caps. Tokenization must stay forward-only, with ASCII folding that preserves source offsets,
quoted attribute handling and raw/comment skipping. Never resolve JSON-LD contexts or itemref;
foreign/redefining contexts must not reinterpret compact terms as schema.org. Keep parsing
and typed RDF vocabulary modules free of runtime `core/` and Node imports.

Gmail and Takeout use `createMailWriter` with extraction on by default; factory options
can opt out or lower limits. Store source RDF and bytes first. Hash booking identities as
[type, senderKey, provider, number], otherwise message/index. Sender keys use the verified
aligned domain or unverified From domain; malformed/missing From remains message-local.
Google evidence is positional: walking headers top-down, every Received above the first
mx.google.com Authentication-Results must be a Google hop (by <host>.google.com with SMTP,
ESMTP, ESMTPS, SMTPS, UTF8SMTP or UTF8SMTPS, or by <IP literal> with SMTP id; never
authenticated submission or LMTP), the last being the inbound MX receipt `from ... by
mx.google.com with ESMTP|ESMTPS|SMTPS|UTF8SMTP|UTF8SMTPS`, directly above the assertion. Any other
hop, a Google POP3/IMAP/HTTP receipt, an unparseable trace or an assertion above the receipt
is unverified. Tokenize per RFC 8601 (quoted strings and CFWS comments) before splitting
result clauses, failing closed on a `"` inside a comment or `(`, `)` or `;` inside a quoted
string; require a single DMARC pass with one unquoted matching header.from, ignoring
later headers and other authserv-ids. Unsupported syntax in the first Google header fails
closed; never fall through to a lower duplicate. Preserve trusted host evidence. Persist sender key/trust and
receiver modification time on message RDF for re-scan. Unverified assertions never overwrite
verified assertions; verified assertions can promote unverified assertions. Preserve ETags.

Clock comparisons use Gmail internalDate or Takeout's bounded mbox From_ separator date (UTC
when zone-less), falling back only when it is absent to the inbound MX receipt time under the
same positional rule, clamped at import time.
Missing time is unknown/epoch for comparison. Never use MIME Date or markup timestamps for
update ordering, including on re-scan; only new dedicated stored receiver metadata is trusted.

Cap extracted scalars at 256 Ki characters per email and independently cap intermediate
microdata values before normalization; retain what fits and flag truncation. Abandon an item while
building it once it exceeds 256 nodes or a running 64 KiB size estimate, before serializing;
still skip items over 64 KiB UTF-8 Turtle, enforcing the cap after session provenance too. Bound source IRIs to
8,192 characters before repeating them across nested provenance. Share item and PUT-attempt
budgets across all messages in createMailWriter/re-scan. Count only items accepted for writing.
Verified mail keeps maxTotalItems (default 2,000) and the per-message maxItems; unverified mail
is capped at 10 items per message and a separate maxUnverifiedItems (default 500, at most
maxTotalItems). PUT attempts (default 2,000) count failures and source inventory PUTs;
unverified PUTs also draw on maxUnverifiedWrites (default 500, at most maxTotalWrites). Decide
and size-check every item before the inventory PUT, list only accepted slugs, skip the
inventory PUT when nothing is accepted, and trim accepted items to the PUTs left.
Verified means DMARC aligned for the From domain, not a trustworthy sender. Catch extraction/markup write failures per message and report stable
codes through writer.errors and ImportReport.errors; keep importing emails and advancing the
cursor. Cancellation still propagates. Depth overflow must keep scanning later JSON scripts.

Persist a bounded fedcon:emailMarkupSlug inventory once per message before item PUTs (skip every
item write with markup-source-missing when the source message read returns nothing), preserve
it on replay without resetting this run's source-message counts, and delete only assertions currently derived from that message before deleting
its RDF. Cleanup runs even with extraction off; Trash retires markup while retaining mail.
Re-scan prune mode checks at most maxPruneItems (default 2,000) purchases/trips resources per
run in slug order after a cursor persisted in mail/<account>/markup-state.ttl (unregistered,
inheriting the account's owner-only access), advancing it while capped and clearing it at the
end, and removes assertions with missing source messages. Keep fixture helpers outside src so ./mail/* cannot expose them.
Cover all roots/encodings, adversarial auth/clock/parser cases, count-based amplification,
trust-update matrix, failure continuation, budgets, removal, prune and re-scan with fixtures.
