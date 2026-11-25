<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

# @jeswr/solid-chat-interop

A pure-RDF reconciler between ActivityStreams 2.0 chat, SolidOS LongChat, and external chat
schemas.

## Install

```sh
npm install github:jeswr/solid-chat-interop#main
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import { parseAs2, serializeLongChat } from "@jeswr/solid-chat-interop";

const resourceUrl = "https://alice.example/chat/room/message.ttl";
const response = await fetch(resourceUrl);
const message = await parseAs2(
  resourceUrl,
  await response.text(),
  response.headers.get("content-type"),
);

if (message) {
  // `#it` is the subject IRI for this SolidOS LongChat message document.
  const longChatTurtle = await serializeLongChat(message, `${resourceUrl}#it`);
}
```

The RDF conversion helpers transform data in memory. `ChatWriter` persists through an injected
pod port; it does not acquire credentials or call global fetch. The canonical model
preserves message content, author, time, replies, edits, deletion, provenance, and task overlays.

## Key API

- Serialized RDF: `parseAs2`, `parseLongChat`, `serializeAs2`, `serializeLongChat`.
- Dataset conversion: `as2ToCanonical`, `canonicalToAs2`, `longChatToCanonical`,
  `canonicalToLongChat`.
- Models and accessors: `CanonicalMessage`, `CanonicalRoom`, `As2MessageDoc`,
  `LongChatMessageDoc`.
- External adapters: `ChatAdapter` from the focused `/adapter` entry and `LibreChatAdapter` from
  the package root; `MAPPING_TABLE` documents the field mapping.
- Node-only shape helpers from `@jeswr/solid-chat-interop/shape`; the raw SHACL file is exported
  at `/shapes/message.shacl.ttl`.

IRI-valued fields from untrusted data are restricted to safe HTTP(S) IRIs on both read and write.

## Generated canonical model

The Message (`as:Note`) and stored Conversation (`as:Collection`) models are generated
by `@jeswr/federation-codegen` from [codegen/](./codegen/) and interpreted by
`@jeswr/model-runtime`. The committed `src/generated/` contains the manifest, fixed JS
shim, declarations, normalized SHACL and input/output hashes. Never edit these files.

The [AS2 facade](./src/as2.ts) keeps the public plain-data types, arbitrary subject
IRIs, media-type and write-time timestamp defaults, PROV-O nesting, and the co-typed
task overlay (closed wins over open). `As2MessageDoc` is a minimal public view of the
generated wrapper; its hand-written field accessors have been removed. ChatWriter
uses the generated message metadata accessors and [conversation facade](./src/conversation.ts).
ACL enforcement, redaction, IDs, timestamps, pagination, adapters, JSON-LD loading and
LongChat reconciliation retain their existing policy.

The profile starts from the social sector's Note/Feed model but preserves this package's
existing AS2 IRIs. The header in [chat.shapes.ttl](./codegen/chat.shapes.ttl) lists every
mapping, narrowing, addition and omission; social IRIs do not become read aliases.
The published [message shape](./shapes/message.shacl.ttl), `/shape` API, and pc: legacy
namespace migration remain available with their original behavior.

Generator/runtime gaps retained in the facade:

- Closed admission cannot express the advisory `rdf:type` qualified task-state shape
  (`sh:qualifiedValueShape` / `sh:qualifiedMaxCount`) or conditional `wf:Task`
  co-typing. Only that property shape is omitted from generation; the published shape
  still contains it, and the facade keeps the existing closed-wins/default-open policy.
- The runtime's HTTP guard normalizes URL identities. Chat's existing lexical HTTP(S)
  filtering and percent-escaping stay in [canonical-iris.ts](./src/canonical-iris.ts),
  a typed singleton accessor for all eight IRI fields. The generated profile retains
  their IRI/cardinality/pattern constraints. The facade restores exact guarded object
  spellings after building and reads them without URL normalization.
- Required fields cannot have config defaults. The facade computes `published = now`
  only on write. Foreign incomplete notes still parse through individually guarded
  generated accessors when strict entity parsing fails; this is a compatibility
  projection, not a SHACL validation result. Missing/malformed content becomes `""`,
  media type defaults to `text/plain`, and malformed/missing dates stay absent. The
  generated entity and published SHACL retain both required-field constraints.
- The sector feed's `core:hasPart` aggregation is outside this stored conversation
  projection: messages remain separate resources discovered through the injected pod
  port. `CanonicalRoom.messages` remains an adapter's plain-data projection.

From the workspace root:

```sh
export PATH=/opt/node24/bin:$PATH
pnpm --filter @jeswr/federation-codegen... run build
pnpm --filter @jeswr/solid-chat-interop run codegen --update-lock
pnpm exec turbo run lint build typecheck test --filter=...@jeswr/solid-chat-interop
node scripts/check-codegen.mjs
```

The drift test regenerates every artifact byte for byte, including the lockfile. All
410 original tests remain unchanged. The build bundles the generated JS and runtime
into `dist/` with esbuild, so no generated-file copy step is needed. Public declarations
use a declaration-only wrapper view with no runtime/generated imports; the runtime is
therefore listed in `mirrorPublish.inlined`. Tests verify this and compile a strict
consumer, including clearing setters. `dist/` remains uncommitted.

## Exact divergences

These changes from the hand-written AS2 core are pinned in
[test/compatibility.test.ts](./test/compatibility.test.ts):

- Ambiguous singleton content, media type, dates, task title and all eight IRI fields
  drop instead of selecting the first value. Content/media type use their existing
  empty/plain defaults; the rest stay absent. Ambiguous stored identifiers/roles or
  conversation titles now cause ChatWriter's existing invalid-resource checks to fail.
- Text reads require `xsd:string`: language-tagged and numeric literals drop instead
  of returning their lexical spelling. Stored conversation titles/identifiers follow
  the same rule. Dates require a valid `xsd:dateTime`; `xsd:date` and impossible
  calendar values drop. Invalid date writes and mistyped body/task-title writes now
  drop the field instead of throwing.
- Data-graph subclasses of `as:Note` and `as:Collection` are recognized through the
  runtime's bounded, cycle-safe class walk.
- Direct `As2MessageDoc` access now uses the generated guards: writes sanitize text,
  IRI fields normalize accepted URLs and drop invalid values, and unsafe/relative
  or non-NamedNode subjects throw. `parseAs2Message` returns `undefined` for an unsafe
  subject. The high-level build/parse facade keeps chat's lexical escaping policy.

The compatibility suite also pins unchanged full-message Turtle/JSON bytes, arbitrary
subject fragments, incomplete-note parsing, lexical IRIs, task state precedence,
published scalar constraint parity, generated SHACL validation, and mirror declarations.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Owner-only conversation storage

```ts
import { ChatWriter } from "@jeswr/solid-chat-interop";

// pod implements ChatPodPort (a structural subset of the MCP DESIGN §3 PodPort).
const chats = new ChatWriter(pod);
await chats.save({
  provider: "codex", // also "claude" or "chatgpt"
  conversationId: "session-123",
  title: "A conversation",
  channel: "hook", // required: "hook", "export" or "mcp"
  messages: [{ id: "event-1", role: "user", text: "Hello", createdAt: "2026-10-25T12:00:00Z" }],
});
const page = await chats.list({ provider: "codex", limit: 20, since: "2026-10-01T00:00:00Z" });
const next = page.nextCursor ? await chats.list({ provider: "codex", limit: 20, cursor: page.nextCursor }) : undefined;
const conversation = await chats.get("codex", "session-123");
```

Each conversation lives under `<pod.root>private/chats/<provider>/<conversationId>/`.
The writer discovers and installs owner-only WAC ACL documents on the chats, provider and
conversation containers, conversation metadata and each message before creating or
accepting those resources, including existing resources skipped with a 412. Resource-specific
grants are replaced; only container ACLs include inherited defaults. It leaves the enclosing
`private/` namespace's ACL alone. ACL failures abort; servers must support the
ACL-before-content sequence and advertise the ACL association even before resource
creation. The port's `discoverAcl` must obtain a unique WAC `rel="acl"` Link from
the exact target and reject unsupported models and unsafe targets. The association
is checked again after each create attempt; existing non-WAC ACL documents abort the
save. Shared ACL documents with `acl:accessTo` or `acl:default` grants for other
resources are rejected before replacing the ACL or writing the target resource.
`ownerOnlyChatAcl(acl, target, owner)` returns the exact owner-only `n3.Store` used by
ChatWriter and MCP's ACL validator: one authorization at `<acl>#owner`, owner Read/Write/Control,
`acl:accessTo` for the target and `acl:default` only for containers. It builds RDF in memory;
callers remain responsible for discovering the association and enforcing conditional writes.

The caller's port must enforce pod scope, refuse write redirects, and reject
HTTP failures with a numeric `status` property. There is no permissive ACL fallback.

Messages are canonical AS2 `as:Note` resources (`m-<id>.ttl#it`) with Dublin Core
identifier/role metadata; conversation metadata is an AS2 collection. User messages
attribute the owner; assistant messages retain their role without claiming a human
author. IDs use 1–200 ASCII letters, digits, underscores or hyphens. Supply source
message IDs for reliable capture: omitted IDs use SHA-256 of role, text and normalized
time, so identical ID-less events collapse. Every message uses `If-None-Match: *`;
412 skips the existing message. First saved title and message contents win. Failed
partial saves can be replayed safely.

`list` returns `{conversations, nextCursor?}`, ordered by ascending conversation URL.
Pass the exclusive URL cursor back with the same provider/since filters. `since`
is exclusive against the latest message's `createdAt`, applied before paging;
empty conversations are excluded when `since` is present. Limit is 1–100 (default
20). Dates require an explicit timezone. Listing scans conversation resources
without a mutable shared index; it is intended for small chat collections.
Containers with missing conversation metadata are skipped as incomplete saves;
permission, transport and message-read errors still propagate.

### Conversation provenance and accounts

`save` requires an explicit `channel`: `hook`, `export` or `mcp`. New conversation
metadata records `prov:generatedAtTime` as an `xsd:dateTime` and
`prov:wasGeneratedBy <_conversation.ttl#capture>`, a `prov:Activity` whose
`dct:type` is the channel literal. An optional `account` adds
`prov:wasAttributedTo <_conversation.ttl#account>`, a `prov:Agent` with the
owner-chosen `foaf:accountName` string. Message attribution is unchanged.
All provenance is written/read through `ConversationProvenanceDoc` typed accessors.
These accessors are hand-written for now; they move into the generated chat-interop model
when bead sst-m3nr flips this package to `@jeswr/federation-codegen` (the provenance shape is
added to the chat-interop profile then).
First metadata wins, including creation time, account and channel. Legacy records
remain readable with absent provenance; replay does not backfill or replace them.
Reads reject ambiguous provenance, non-string account/channel terms, invalid
creation timestamps and account/activity references outside the metadata document.

Account labels are NFC-normalized and trimmed, then must contain 1–64 UTF-16 code
units. Control and format characters are rejected, including at the edges before
trimming. `normalizeChatAccount` validates without echoing input. Labels use the
same secret redaction as titles; if replacement markers grow beyond 64 characters,
`redactChatAccount` hides the entire label as `[REDACTED]`.

`ChatWriter.save` takes an already resolved conversation ID. When deriving that ID
from an external/source ID, scope it first with `chatConversationId(id, account?)`:

```ts
import { chatConversationId } from "@jeswr/solid-chat-interop";
const account = "Work";
const conversationId = await chatConversationId("session-123", account);
await chats.save({ provider: "codex", conversationId, account, channel: "hook", title: "Session", messages: [] });
```

This SHA-256 derivation includes the normalized label before redaction, so even
two labels whose secrets redact identically remain distinct without exposing the
label in a path. An absent account returns the old ID byte-for-byte. Importer/parser
results already contain scoped IDs; do not scope those again. `get` accepts the
stored ID returned by `list` or extracted from the save URL. `get` and list summaries
expose `account?`, `channel?` and `generatedAtTime?`. `list({account})` matches the
normalized, redacted stored label before pagination; labels that redact to the same
text match the same filter. Transcript headers escape and re-redact account labels.

### Redaction

<!-- AUTHORED-BY Codex GPT-6 -->

`redactSecrets` runs on every stored title and message and again on transcript export.
Following Jesse's 10 November 2026 decision (sst-5ax.36), assignment redaction replaces
only secret values with `[REDACTED]`, including env values. Names, operators, quotes and
surrounding code stay: `const apiKey = "abc123"; const total = a + b;` becomes
`const apiKey = "[REDACTED]"; const total = a + b;`. Ordinary assignments, comparisons,
keyword arguments, loops and Markdown survive byte-for-byte unless they contain a
credential. The rule errs toward redaction.

Secret-looking names match these case-insensitive substrings: `token`, `secret`,
`password`, `passwd`, `pwd`, `passphrase`, `pass`, `credential`, `creds`, `auth`,
`cookie`, `session`, `bearer`, `signature`, `salt`, `dsn`, plus `connectionstring`
and `connstr` after joining word parts. This covers `client_secret`, `access_token`,
`refreshToken`, `connection_string` and `conn_str`. `key` and the short password name
`pw` must be whole word parts, split on underscores, hyphens, dots or camelCase/acronym
boundaries: `KEY`, `API_KEY`,
`apiKey`, `private_key` and `key_count` redact; `monkey` and `keyboard` survive.
`auth` skips `author` and `authority` but still matches `authorization`/`authorisation`.
A bare TypeScript type after `name:` (`token: string`, `password: string | null`) is
kept. An initializer after the type still redacts: `const token: string = 'abc'`
becomes `const token: string = '[REDACTED]'`. Type scanning accepts unions, arrays
and generics such as `Record<string, string>`, up to 256 characters, including line
breaks. Recognized types that exceed that bound, and windows cut off at the bound
while they could still become a type (a long generic head, or only whitespace), redact
the uncertain remainder of the input so an initializer on a later line cannot leak. `==` and `=>` stay code; a quoted
`"string"` value still redacts.

The value rule covers shell assignments/exports, `=`/`:`/`:=` code and object keys
(including quoted JSON keys), CLI flags (`--password value`, `--token=value`), and
URL query parameters. Compact env lines starting with an optionally indented/exported
`UPPER_SNAKE_CASE=` name redact regardless of the name, covering `DATABASE_URL` and
`STRIPE_LIVE`; lowercase or spaced neutral code assignments stay. URL userinfo
passwords also redact.

Values never cross a line break, except on an unambiguous env line (an optionally
exported `UPPER_SNAKE_CASE=` assignment at line start), whose multi-line quotes and
backslash continuations redact in full. Everywhere else an unterminated or ambiguous
quote redacts to the end of its line and scanning resumes on the next line, so a value
can never swallow a later key while leaving that key's value visible; the price is that
a mid-line multi-line string keeps its later lines. In shell and env assignments,
backslashes are literal inside single quotes, and a word continues after a closing
quote (`'abc\'123'` redacts as one word, quotes included). Code string literals (JS,
Python, JSON, `name: '...'`) and double quotes support backslash escapes, so
`'abc\'def'` is redacted to its real end. Following code and lines stay.

Unquoted value boundaries depend on syntax:

- Shell/env words include `,`, `)`, `}` and `]`, quoted segments, escaped whitespace
  and backslash continuations. Compact `NAME=` assignments at shell word boundaries
  use these rules; declarations and function arguments use code rules. Unquoted `;`,
  `&&`, `||` and `|` end a shell word, even without spaces: `export PASS=a;b` becomes
  `export PASS=[REDACTED];b` because `b` is a separate command. Escaped or quoted
  semicolons belong to the value: `export PASS=a\;b` becomes `export PASS=[REDACTED]`.
- URL query values stop only at `&`, `#`, whitespace, quotes, backticks or angle
  brackets. Punctuation such as `;`, `,`, `)`, `}` and `]` stays inside the redaction.
- Code, object keys, YAML, JSON and CLI flags retain the code delimiters: whitespace,
  `;`, `,`, `)`, `}` and `]`, with escaped whitespace and continuations included.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

`redactSecretFields(fields)` normalizes and redacts an ordered array without mutating it.
`redactConversation(conversation)` returns a copy with title and message text redacted in
title → message 1 → message 2 order, preserving all other metadata. The writer, transcript
renderer and capture paths use this shared helper. Optional
`redactConversation(conversation, { chunks })` accepts a readonly array of source-chunk
arrays in message order (one array per message; mismatched counts throw). Chunks
replace message text, are checked together before joining each message with `\n`
and trimming it, and the assembled conversation is checked again. Empty chunk arrays
produce empty text. The helper never mutates conversation metadata or source chunks.
Export importers use this path instead of mapping fields themselves. After
per-field redaction, adjacent fields are checked using the last 512 UTF-16 code units
of the left field and the first 512 of the right, with edges snapped inward to complete
code points, joined without a separator. A detection whose context spans that join
replaces each covered value piece with `[REDACTED]`; names, quotes
and surrounding code stay. Normalized source windows are also checked so an earlier
per-field marker cannot hide a prefix while exposing its continuation. Existing
marker text is preserved, including spans contained in a marker; touching fragments
extend that marker's coverage without duplicating it. Zero-width boundary spans are
ignored. A URL's trailing `@` counts as context even when its password is wholly in
the preceding field, provided that field still ends in userinfo. An existing userinfo
`@` completes the left authority; a later message's `@mention`
cannot extend it. An undelimited host:port-looking suffix is ambiguous: a following
field's `@` establishes userinfo even when the password is numeric and wholly on
the left or continues on the right. These values redact conservatively, including
when the right field could be an @mention. Unambiguous host:port URLs ending in `/`
or followed by whitespace or a path stay intact. Appending a neighbour preserves
already detected messages' text and content-derived IDs. A closing quote at a field
boundary completes a shell word and keeps its delimiters: appending `Thanks` after
`export API_KEY="fixture"` leaves `export API_KEY="[REDACTED]"` unchanged. Prefixes
retain the same redacted text as the full conversation, except that later context
completing an unresolved secret may add redaction, never remove existing coverage.
The field-array operation is idempotent.
A left value already consisting only of markers ends boundary continuation, preventing
repeated passes from consuming another window of the next field. Source windows still
detect plaintext continuations on the initial pass.
Edited fields are checked once more for assignments exposed by boundary removal.
Capture/import callers must apply this before queueing or splitting saves into batches.

A private-key END delimiter without a preceding BEGIN in the same field conservatively
redacts everything from that field's start through the last END delimiter. Following
text survives. This rule applies only to whole fields: appending an orphan END cannot
redact preceding prose or titles. Both PEM rules accept `PGP PRIVATE KEY BLOCK`.
Once a BEGIN header is recognized, redact to its first END or the conversation end,
including entire subsequent fields and arbitrarily long bodies without END. BEGIN
and END delimiters split across one join are recognized within the window. This
continuation remains linear and stops before text following END; the per-field
orphan rule can still cover later orphan END delimiters in the same field.

The boundary pass is linear in total input size plus field count and collects all
matches before replacing them. It checks adjacent pairs only, within the 512-code-unit
windows: credentials requiring three fields or more distant context are outside this
policy, except the PEM-body continuation above. A delimiter itself requiring three
fields, or more than 512 units of context across a join, remains outside it.
Separator-free detection errs toward redaction: a complete token at one field's
end can also cover the next field's first word. A caller that has already redacted each
source field independently cannot recover a hidden prefix; pass the complete original
field array to this helper before discarding source text.

Before detection and after boundary replacement, the shared text normalizer strips
lone surrogates (Unicode Cs), C0/C1 controls except tab/CR/LF,
and every Unicode General_Category=Cf character except emoji ZWJs and subdivision-flag
tags. U+200D survives only between Extended_Pictographic characters, each optionally
followed by U+FE0E/U+FE0F and/or a skin-tone modifier (either order). Variation selectors
U+FE00–U+FE0F and U+E0100–U+E01EF are removed except U+FE0E/U+FE0F on an emoji
base (including its modifier) or within a complete keycap. A digit followed by a
selector without the keycap mark is stripped too, preventing token suffix leaks.
Subdivision flags require
U+1F3F4, exactly two tag lowercase letters (U+E0061–U+E007A), then 1–4 tag lowercase
letters or digits (U+E0030–U+E0039), then U+E007F. All other U+E0000–U+E007F tags are
removed, including arbitrary hidden instructions. Family/profession emoji, skin-tone
variants and England/Scotland/Wales flags retain their exact bytes. Zero-width spaces,
word joiners, BOMs, soft hyphens and bidi controls are removed before persistence
and again on export, so they cannot split credential patterns.

Package-specific agent guidance lives in [SKILL.md](SKILL.md).

The existing PEM private-key, `sk-`, GitHub, AWS key-ID, JWT and `Authorization:`
header rules run first with their existing markers. Redaction is pure, emits no
diagnostics containing input, and produces a fixpoint, so derived message IDs stay
stable when capture and storage both redact. Value scanning takes linear time.

### Repairing chats stored before redaction

Older MCP `chat_save` calls stored titles and message text verbatim, and the redaction rules
have grown since. `migrateRedaction()` is an owner-run repair (bead sst-5ax.39):

```ts
const report = await chats.migrateRedaction({ dryRun: true }); // counts only, no writes
await chats.migrateRedaction();
// { conversations, titles, messagesRewritten, messagesReplaced, conflicts, failed, unverified }
```

It walks every provider's conversations and redacts each one as a whole, like `save`: the
title and all messages go through the same redaction together (`redactSecretFields`), so a
secret split across the title and a message, or a PEM block across messages, is caught. It
checks each title, account label and message against the current redaction rules. Every
change is conditional on the strong ETag it read, so the port's `read` must return one; a
resource that changed meanwhile (412) is counted in `conflicts` and left for the next run.

What the repair guarantees, and what it does not:

- **Stored order.** Messages are read in stored order (`createdAt`, then ID), which equals the
  order they were submitted in only when timestamps differ. Messages sharing one `createdAt`
  sort by ID, a digest for ID-less messages, so their stored order is arbitrary. The stored
  data carries no sequence number, reply link or derivable ID that restores it. So each run
  of equal timestamps is redacted as if stored in ANY order: a field is redacted if it would
  be under some ordering, which can redact more than `save` would have (for example a
  message beside a key block, a word after a token at the end of a sibling). Every adjacent
  pair a run can produce is examined, and a PEM block that any member opens covers the rest
  of the run up to its first END. Over-redaction is the price; a surviving fragment is not,
  within the detectors' own limits (adjacent pairs and PEM continuation, see above).
  A run of more than 64 messages, or two neighbouring runs with more than 4096 ordered pairs
  between them, is too large for that and is NEVER blanket-redacted: each member is redacted
  as it would be alone, each against its stored neighbours, and a PEM block is followed in
  stored order (the BEGIN and END members and those stored between them are covered, other
  members are untouched; a run in which nothing changes is left byte-identical). The
  any-ordering guarantee is then unproven (a key body stored before its BEGIN, or a secret
  split over two members that are not stored neighbours, can survive), so the conversation
  counts in `failed` and in `unverified` on EVERY run, deterministically, even when nothing
  needs writing, and `solid-capture redact-archive` tells the owner to review it by hand. A
  run that reports it is never clean (exit 1) until the conversation is fixed by hand.
- **Replay IDs.** The text stored for a message, and so the ID a replay derives, equals what
  `save` of the original conversation would store only when the conversation has no equal
  timestamps (or none that redact differently). Otherwise a replay of the original through
  `save` can derive different IDs and write a duplicate beside the repaired message.
- **Interruption.** A write that fails (412, timeout, 5xx) or a crash must never leave half a
  secret that the next run cannot see, because the next run only sees what is stored. The
  field carrying the context (a PEM `BEGIN`, a token prefix, the title) must not be replaced
  while a still-raw field needs it. The run therefore writes in an order it checks: a field
  is written only if re-redacting the stored state after that write still redacts every other
  field to what an uninterrupted run produces. In practice that is last message first, title
  last. The first write that does not land stops the conversation (the run counts it, and
  every change it left unwritten in `conflicts`), and the next run resumes. For any
  interruption point, re-running converges on the uninterrupted result and no fragment
  survives (the test suite injects a failure at every write of three split-secret
  conversations, in both naming schemes, and for every stored order of a tied key block).
  Where no such order exists (two fields that each need the other raw, such as one
  unterminated quoted value repeated in two messages) or the conversation has more than 48
  mutually dependent changed fields (each check re-redacts the conversation), the run still
  repairs, last field first, but counts one `failed` for the conversation so it never reports
  clean; the following run, with nothing left to change, reports clean. An interruption
  inside such a conversation can leave half a secret that the next run no longer detects;
  a durable "repair in progress" record would close that and is not implemented.
- A message that is already the redacted copy of a sibling with the same role and time (an
  interrupted move leaves the copy and the original side by side) is kept as it is and
  excluded from the redaction input, so it neither widens nor is widened by the original.

- Titles and account labels are rewritten in place with `If-Match`, keeping the rest of the
  metadata (provenance). Stored IDs and paths never change, even when a label redacts.
- A message named by a hash of its unredacted text moves to the ID a redacted save derives.
  The redacted message is created owner-only first (ACL before content, as in `save`), then
  the original is deleted with `If-Match`. When a redacted copy with the same role, text
  and time already exists, which is what a replay after the redaction change wrote, it is
  kept and the original is deleted. A copy that does not match is never trusted: the
  original stays and counts as `failed`.
- Writers before 4 November 2026 hashed the raw text but stored it without control
  characters, so such a name no longer matches its text. Outside capture, any 64-hex message
  name whose text changes is treated as one of these and moved. Capture always passes
  hash-shaped source IDs and redacts first, so in conversations with channel `hook` or
  `export`, or legacy ones with no channel and a 64-hex conversation ID, messages are
  rewritten in place and keep their IDs.
- Every other message is rewritten in place under its ID with `If-Match`; its ACL is not
  touched. A message saved both with a source ID and without one stays as two messages, as
  before.
- A conversation whose metadata is missing still has its messages repaired. So does one
  whose metadata is unreadable or fails validation (wrong identifier, invalid title): that is
  counted in `failed`, the metadata is left as it is and its messages are redacted anyway. An
  account label that fails validation (too long, control characters) may still hold a secret,
  so it is replaced by `[REDACTED]` and counted in `titles`.
- The repair does not audit who can read a conversation; it never changes an ACL it did not
  create.

One unreadable or malformed conversation or message, a missing ETag, or a failed request
counts in `failed` (no URLs or content are reported). A failed or conflicting write stops
only its own conversation; the run carries on with the next one. After a run that reports
`failed` and `conflicts` of 0, every title, label and message the run could check matches
the current rules and each message appears once. Replaying the original conversation writes
nothing only when its redaction equals the repaired text (see Replay IDs above). Re-running
is safe. The real run needs the optional `ChatPodPort.delete(url, { ifMatch })`; a dry run does
not. Delete must reject an ETag mismatch with status 412, and the server must delete the
resource's ACL with it, as Solid servers do. `solid-capture redact-archive [--dry-run]` in
`@jeswr/agent-session-capture` runs it with the owner's MCP configuration.

## Links

- [Source](https://github.com/jeswr/solid-chat-interop)
- [Issues](https://github.com/jeswr/solid-chat-interop/issues)
- [ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-core/)

## License

[MIT](./LICENSE) © Jesse Wright

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
The `pc:` constants and serializer prefix use `NS.POD_CHAT` from `@jeswr/suite-vocab`
(`https://jeswr.org/ns/pod-chat#`). Dataset serialization accepts legacy pc: predicates
and class objects and emits their canonical spellings, preserving resource identities
and literals. Message parsing is unchanged: messages use ActivityStreams, and a
containing dataset may carry either canonical or legacy room descriptors.
