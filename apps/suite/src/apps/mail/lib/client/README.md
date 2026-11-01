<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Mail client (MAI-01)

`new MailClient(fetch, storageUrl)` owns one `MailStore`. Pass an optional third
`webId` argument when the session has a profile IRI; the two-argument form uses
`profile/card#me` under the storage root. The React provider always supplies the
session's WebID. All reads and writes, including attachment bytes, retain the
model's pod scope. The new `model/client-support.ts` module owns profile pointer
and attachment metadata access; existing model behaviour is unchanged.

Folder keys are reversible document identifiers, with reserved system IDs and
`label:<encoded document slug>` for custom folders. Label display titles stay in
metadata. Accounts use the model's reversible tilde escaping, decoded on listing.
The binary `mail/attachments/` namespace is excluded from the account picker.

Folder paging and search operate on loaded pod snapshots. Search evaluates only
the newest 5,000 message summaries, deduplicates matching conversations and
returns at most 200 by default. The pod has no date-sorted server index, so
obtaining that snapshot still requires reading folder-member metadata.

The streaming importer preflights each bounded RFC822 message with the model's
MIME parser, then feeds valid bytes to one `importMbox` run. This deliberately
parses MIME twice: it lets a malformed individual message be reported and skipped
without closing the importer's generator or losing its cross-message ancestry
map. Mboxrd escaping is restored byte-for-byte between the two splitters, including
legacy encodings and unterminated final messages. Persistence failures are
reported separately and processing continues. Cancellation is checked between
messages; an in-progress conditional message write completes first. Failed
multi-document writes can leave partial resources, as documented by the model.

Private Type Index discovery follows a direct profile pointer or the linked
Preferences Document. A missing pointer is an explicit `missing` outcome; unreadable
profiles and registration failures produce `failed`, without hiding a successful
mail import. No index or preferences document is bootstrapped by this client.

The reader renders only `sanitizeMessageHtml` output in `sandbox=""`, with no
same-origin access and a restrictive CSP. Remote image URLs are removed by the
sanitizer. Height cannot safely be measured across that boundary, so HTML mail
uses a fixed-height scrolling frame. Plain mail stays React text, with quote
segments behind a disclosure.

The provider serializes optimistic read/star/archive writes. Ordered field patches
remain visible until a sufficiently recent request completes; failure removes only
that mutation's patch, so it cannot undo a later change. Requests are fenced by
generation, and mail change events are coalesced before refreshing subscribers.
Archive toasts restore Inbox membership and remove Archive membership on Undo.
