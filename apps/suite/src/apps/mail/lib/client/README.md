<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Mail client (MAI-01)

`new MailClient(fetch, storageUrl)` owns one `MailStore`. Pass an optional third
`webId` argument when the session has a profile IRI; the two-argument form uses
`profile/card#me` under the storage root. The React provider always supplies the
session's WebID. All reads and writes, including attachment bytes, retain the
model's pod scope. Attachment/original bytes use `binaryFetch`, which checks pod scope
without parsing JSON-LD. `model/client-support.ts` owns profile pointers, address
display names and attachment metadata. Rendering never probes attachment availability.

Folder keys are reversible document identifiers, with reserved system IDs and
`label:<encoded document slug>` for custom folders. Label display titles stay in
metadata. Accounts use the model's reversible tilde escaping, decoded on listing.
The binary `mail/attachments/` namespace is excluded from the account picker.

Folder paging and search operate on loaded pod snapshots. Search evaluates only
the newest 5,000 message summaries, deduplicates matching conversations and
returns at most 200 by default. The pod has no date-sorted server index, so
obtaining that snapshot still requires reading folder-member metadata.

The streaming importer uses one model splitter and one MIME parse per message.
Per-message MIME and persistence failures are reported and processing continues.
An oversized message is discarded with bounded memory until the next separator;
its neighbours and the cross-message ancestry map survive. The standalone model
splitter/importer remain fail-fast unless recovery callbacks are supplied.
Cancellation is checked between messages; an in-progress conditional message write
completes first. Failed multi-document writes can leave partial resources.

Private Type Index discovery follows a direct profile pointer or the linked
Preferences Document. A missing pointer is an explicit `missing` outcome; unreadable
profiles and registration failures produce `failed`, without hiding a successful
mail import. No index or preferences document is bootstrapped by this client.

The reader renders only `sanitizeMessageHtml` output in `sandbox=""`, with no
same-origin access and a restrictive CSP. Remote image URLs are removed by the
sanitizer. Height cannot safely be measured across that boundary, so HTML mail
uses a fixed-height scrolling frame. Plain mail stays React text, with quote
segments behind a disclosure. Quote-parser size/line limits fall back to a plain-text preview capped at
65,536 UTF-16 code units, with an original-message download. Display names are retained in
the model; unnamed addresses remain usable. Folder unread badges count conversations
with any unread message, including replies outside the folder.

The provider serializes optimistic read/star/archive writes. Ordered field patches
remain visible until a sufficiently recent request completes; failure removes only
that mutation's patch, so it cannot undo a later change. Requests are fenced by
generation, and mail change events are coalesced before refreshing subscribers.
Archive toasts restore only Inbox/Archive memberships changed by that operation,
per message. Already archived messages produce no write or Undo action. Import
callbacks are fenced by wizard lifetime and import generation.
