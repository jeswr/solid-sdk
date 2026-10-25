<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Mail model (MAI-00)

Pure RDF models ported from `apps/pod-mail/src/model`; no React or SDK facade imports.
`Message`, `Thread`, `Folder`, `Attachment` and `TypeIndexDataset` are live typed wrappers.
Use `parseMailbox` and `serialiseToTurtle` for complete-document round trips.

Construct `new MailStore(authenticatedFetch, storageRoot)`. All I/O takes this injected
transport, checks pod scope (including redirects), and preserves validators. Existing writes
require a strong ETag; creates use `If-None-Match: *`. `MailError` exposes `code` and `status`.
Network/parser errors retain their original cause. After any conflict or partial write, reload.

`loadFolders`, `loadThreads` and `loadThread` return hook-free data. Pure `folderCounts`,
`pageThreads` and `threadMessages` also work on cached snapshots. Paging is stable over the
loaded snapshot; it does not imply server paging. `setRead`, `setLabel`, `setStarred` and
`archive` persist conditional mutations. Stars are collection membership; read state is
`schema:dateRead`. Membership is maintained as folder `schema:hasPart` and message
`sioc:has_container`, preserving other labels. Cross-document writes are sequential.

`importMbox(chunks, storageRoot, account, mintId)` is an async generator over mboxrd bytes,
including extracted Gmail Takeout mbox files. It decodes MIME with postal-mime, honors
References/In-Reply-To, handles Gmail labels/status, and yields one message plus raw `.eml`
bytes and attachment binaries. RFC 822 source is preserved after mboxrd unquoting. Each message
is bounded to 25 MiB; MIME is buffered per message, never per mailbox. `mintId` supplies IDs
for mail lacking Message-ID. Subject similarity alone never merges threads. References is
preferred for out-of-order mail; In-Reply-To-only chains resolve through previously seen mail.
ZIP extraction belongs to the file connector.

`persistImportedMail` writes attachments under `mail/attachments/`, `.eml` beside each message,
then metadata, thread and folder membership. It rejects collisions rather than overwriting
existing content. A failed multi-document import can leave partial resources; it does not
roll back or automatically retry. The caller reports the failure and can reload/clean up.
`register` updates a caller-supplied existing Type Index; SDK-APP-10 owns bootstrap/discovery.

Gmail export label headers follow [Google's Takeout documentation](https://support.google.com/accounts/answer/3024190?hl=en).
