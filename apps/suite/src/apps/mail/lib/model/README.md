<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Mail model (MAI-00)

Typed RDF models ported from `apps/pod-mail/src/model`; no React or SDK facade imports.
`@jeswr/pod-connectors/mail` owns the shared framework-free MAI-01 path slugs, reserved
system-folder titles, standard mail IRIs, linear HTML-to-text scanner and MIME address
conversion. `paths.ts` resolves those relative slugs with `new URL` while preserving its
existing URL/identifier validation; `vocab.ts` preserves the app's names as re-exports.
Typed wrappers, MailStore I/O, operations, importer orchestration and Type Index handling
remain local. The standalone app still uses its older layout without an account segment.
`Message`, `Thread`, `Folder`, `Attachment` and `TypeIndexDataset` are live typed wrappers.
Use `parseMailbox` and `serialiseToTurtle` for complete-document round trips.

Construct `new MailStore(authenticatedFetch, storageRoot)`. All I/O takes this injected
transport, checks pod scope (including redirects), and preserves validators. Existing writes
require a strong ETag; creates use `If-None-Match: *`. `MailError` exposes `code` and `status`.
Network/parser errors retain their original cause. After any conflict or partial write, reload.
Inline JSON-LD contexts are supported; remote contexts and `@import` are rejected before parsing
because the RDF parser cannot apply the scoped transport to its context loader.

`loadFolders`, `loadThreads` and `loadThread` return hook-free data. Pure `folderCounts`,
`pageThreads` and `threadMessages` also work on cached snapshots. Folder paging loads every
referenced message in the candidate threads, including replies in other folders, before sorting.
Paging is stable over the loaded snapshot; it does not imply server paging.
`setRead`, `setLabel`, `setStarred` and
`archive` persist conditional mutations. Stars are collection membership; read state is
`schema:dateRead`. Membership is maintained as folder `schema:hasPart` and message
`sioc:has_container`, preserving other labels. Cross-document writes are sequential.

`importMbox(chunks, storageRoot, account, mintId)` is an async generator over mboxrd bytes,
including extracted Gmail Takeout mbox files. It decodes MIME with postal-mime, honors
References/In-Reply-To, handles Gmail labels/status, and yields one message plus raw `.eml`
bytes and attachment binaries. RFC 822 source is preserved after mboxrd unquoting. Each message
retains decoded HTML as inert `bodyHtml` (`schema:articleBody`); `body` prefers plain text and
otherwise contains a readable HTML-to-text fallback. HTML must be sanitised before rendering.
HTML-derived bodies that exceed the shared scanner's visible-text or input-scan limit append
`HTML_TEXT_TRUNCATION_NOTICE` on its own paragraph; `parseEmail` and `importMbox` expose
`bodyTruncated: true` on those per-message results. Full HTML and raw source remain available.
Generated identifiers use reversible tilde escaping, avoiding encoded path delimiters while
retaining original Message-IDs and folder titles as metadata. System folders use reserved
`folders/system:<id>.ttl` documents (for example `system:inbox`); custom label keys retain their
case and escape colons, so even a custom `system:inbox` label stays distinct. Archive and star
mutations use the same reserved system documents.
The splitter accumulates fixed blocks of at most 64 KiB and classifies separator/quote prefixes
across chunk boundaries without buffering whole lines. Each message is bounded to 25 MiB;
MIME is buffered per message, never per mailbox. `mintId` supplies IDs
for mail lacking Message-ID. Subject similarity alone never merges threads. References is
preferred for out-of-order mail; In-Reply-To-only chains resolve through previously seen mail.
ZIP extraction belongs to the file connector.

`persistImportedMail` writes attachments under `mail/attachments/<account>/`, `.eml` beside each message,
then metadata, thread and folder membership. It rejects collisions rather than overwriting
existing content. A failed multi-document import can leave partial resources; it does not
roll back or automatically retry. The caller reports the failure and can reload/clean up.
`register` updates a caller-supplied existing Type Index; SDK-APP-10 owns bootstrap/discovery.

Gmail export label headers follow [Google's Takeout documentation](https://support.google.com/accounts/answer/3024190?hl=en).

Compatibility boundaries: this app still permits dot message/thread IDs, arbitrary explicit
system keys and unvalidated attachment account/ID/index values; connector entry points keep
their existing stricter account/document checks. Generic folder documents retain their exact
case; only system folders use reserved lowercase keys. All mail uses `http://schema.org/`.
MIME address groups share the existing whole-address `mailto:` encoding; Message-ID,
References and invalid-date policies remain local because they differ from the connector.
`htmlText.ts` re-exports the shared `htmlToText` compatibility API, `htmlToTextResult` and
`HTML_TEXT_TRUNCATION_NOTICE`. The scanner folds only ASCII keywords, preserving Unicode
offsets. It scans at most `MAX_HTML_INPUT_CHARS = 8,388,608` UTF-16 code units and caps
normalized visible text at `MAX_HTML_CHARS = 1,048,576` UTF-16 code units, preserving surrogate
pairs. Leading comments and skipped blocks do not consume the visible-text allowance;
exceeding either bound sets `truncated`. Compared with the old regex fallback, it drops unfinished markup and
unclosed script/style/head bodies and decodes uppercase named entities. Valid mail fixtures
retain their output; the cap and malformed-input behavior prevent hostile rescans.
