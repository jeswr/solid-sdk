<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
# @jeswr/solid-events

Solid-native invitations with an independent, reusable RSVP model. `codegen/events.ontology.ttl`,
`events.shapes.ttl` and `codegen.config.json` are the source of truth. Generated entities, typed
wrappers, SHACL and hashes live in `src/generated/`; regenerate with `pnpm run codegen --update-lock`.
The drift test regenerates every artifact and compares its bytes. Never edit generated output.

The public browser entry exports `entities.Event`, `entities.Rsvp`, `entities.Invitee`, their Data
interfaces, domain validation, `summariseRsvps`, invitation/reply I/O and `createEventsRepository`.
`model.ts` is a thin facade: it exports generated entities and validates cross-field invitation policy.
It contains no RDF accessors. All RDF build/parse/write operations use generated entities and fetch-rdf.
Access graphs are produced and changed exclusively through pod-access.

## Model

The schema namespace is `https://schema.org/`; Dublin Core is `http://purl.org/dc/terms/`.
Suite-only predicates use `https://jeswr.org/ns/events#`.

| Entity | Class | Fields / predicates |
| --- | --- | --- |
| Event | schema:Event | schema:name, description, startDate, endDate, location (text), address (text), url (onlineUrl), image, organizer, eventStatus, maximumAttendeeCapacity (capacity); dct:created, modified; ev:visibility (`invitees`/`link`), guestListVisible, publication (`draft`/`published`), rsvpDeadline |
| Rsvp | schema:RsvpAction | schema:agent, object (`event`), rsvpResponse, additionalNumberOfGuests, comment, startTime (`repliedAt`), name (`displayName`); ev:guestKey |
| Invitee | schema:InviteAction | schema:recipient (`webId`), name (`displayName`), object (`event`), startTime (`invitedAt`) |

Event status and RSVP responses retain the schema.org **IRI** enums. The generator supports these;
no literal enum substitution was needed. `Rsvp` is its own entity, never folded into an Event composite.
The generated accessor name `event` maps to schema:object because `object` is reserved by the runtime.

The profile starts from the scheduling sector's CalendarEvent/Attendance constraints, maps them to
schema.org invitation terms, narrows `sh:or` date/dateTime to dateTime, requires an organiser IRI,
omits external-agent `sh:class` assertions, and omits recurrence, calendars, tasks, reminders and
availability. The profile also narrows additional guests to 0–20. The profile header lists these changes. All-day invitations are deferred. Agent-or-name
validation and date ordering are facade policy because closed admission cannot express that `sh:or`.

## Storage and access

`events/<id>/index.ttl` stores one invitation. `rsvps/` stores one immutable resource per reply;
`invitees/` stores independent InviteAction resources. Event instances are registered in the private
Type Index. The base, per-event folders and invitee records inherit owner-only access. Drafts remain
private. Existing content writes use observed ETags and reject conflicts without retrying stale edits.
Missing own WAC documents are bootstrapped only at an advertised ACL link with If-None-Match; existing
policies are inspected and never overwritten. New reply/event resources are protected before publishing.

Publishing grants invitees (or the public for link invitations) Read on the invitation and **Append only
on the reply container**. Visible guest lists add Read on the container and its children separately;
Append is never inherited to individual replies. Replies are immutable, so changing a response writes
a fresh resource. Hidden lists are readable only by the organiser. There is no guest Write grant.
The first cut supports Solid WAC. Unsupported discovery/access models fail closed; ACP and LWS are
future work. The explicit `demo: true` adapter requires the in-browser fixture's non-enforcement header;
it is never selected automatically for real storage and does not establish actual access enforcement.

Sharing settings are fixed after creation. Saved drafts can be published after confirmation.
Cancellation and postponement revoke guest Append grants before writing the new status;
separate guest Read grants and the organiser's access remain. Reopening replies is deferred.
Publishing is a multi-resource operation: a failed creation may leave a recoverable private draft in the organiser's pod, and a failed
publication may leave some of the intended audience's grants applied. It never grants a wider audience.

`publicEventFetch` wraps the caller's credential-bounded transport with guarded-fetch and refuses redirects.
Foreign URLs are read only in the browser. Node consumers must inject a DNS-pinned transport according to
guarded-fetch's contract. Remote descriptions are plain text. Validated HTTP(S) cover images load only on the organiser
detail and invite page, with lazy loading and no referrer.

## Reply trust model

An Append grant authenticates access to the container, **not the WebID in a submitted reply**.
The default WAC flow cannot prove authorship, so WebID and anonymous claims appear under
**Unverified replies**, separately from the verified tally. Unverified revisions are grouped by claimed WebID, or by guest receipt hash when there is no WebID.
The latest claim is counted only in a separately labelled unverified tally; superseded claims appear
as earlier replies. A claimed WebID or copied guest hash cannot replace any verified reply.
Anyone can copy these public correlation keys, so this grouping does not establish identity.
A successful authenticated POST alone does not prove the submitted agent owns its WebID.

`readReplies` accepts an optional `authenticatedCreator(url, response)` deployment adapter. It
must obtain authenticated creator evidence from a trusted server contract, never from submitted
RDF, a generic HTTP header or a URL that merely resembles the agent's pod. Only an exact match
with the claimed agent sets `Reply.verifiedAgent`. Pure `summariseRsvps` callers may supply that
field only after equivalent verification. The Events UI supplies no such adapter and therefore
makes no verified identity claims. Own-pod link verification is not implemented.

Verified replies use server `Last-Modified` when available, otherwise the submitted `repliedAt`.
The server must keep that metadata outside the appender's control. When server time exists, the claimed time is ignored. Otherwise the claimed time is used.
The effective time must be no more than five minutes ahead of the supplied/current clock. Latest verified reply per
agent wins, with lexical URL ties; the effective server time also flags deadline lateness for both verified
replies and unverified claims.
Additional guests are whole numbers from 0 to 20 and count only for Yes replies in each tally.
Remaining capacity estimates use verified plus unverified going (including additional guests);
the UI explicitly labels this advisory estimate and the separate trust levels.

The browser retains the random receipt key locally, scoped by account and event. `appendRsvp`
serialises only its SHA-256 hash, including on publicly readable guest lists. The hash is a
correlation hint, **not** a bearer credential or identity proof. It groups only unverified revisions.
Clearing browser storage loses the local receipt. Earlier unverified replies are collapsed and
do not affect either current tally. Historical reply files may
contain plaintext keys; readers never use those keys to authenticate anyone. Capacity is advisory.

Replies are created by POST to `rsvps/` with a Slug hint and the server's scoped Location is used
as the receipt URL. The subject is generated independently of the final document name. No guest
child Write or inherited Append is needed. `readReplies` returns `{ replies, invalid, total, nextOffset, listingLimited }`: individual
malformed, unreadable, unrelated or over-64-KiB resources increment `invalid`; container denial
still rejects. The reader reuses fetch-rdf's streaming byte cap (storage-client's `boundedText`
is internal), refuses redirects, and reads at most 200 eligible files per call, with at most
six requests active, in listing order. Pass `offset: nextOffset` to read another page without
re-fetching earlier files. The UI shows loaded/total files and a Load more control; counts apply
only to loaded replies. Listings are capped at 2 MiB. Parser/transport safety-limit refusals return
`listingLimited: true`, `total: null` and no replies, with a notice instead of an error state.
Access denials and ordinary listing failures still reject. The organiser view also uses `publicEventFetch` outside demo.
Invitation folders are isolated per read, and the app displays a notice when any fails. Queued
organiser saves continue after React unmount; failures use the shared module-level toast.
A module-level save-settlement signal refreshes remounted controllers for the same event base.
Cancellation preserves owner grants, revokes only non-owner Append-only rules, and refuses mixed
Append rules or rule IDs shared with the owner before making any access changes.
The first cut has no durable outbox and cannot guarantee writes after browser termination.

## Deferred

- Add to calendar: needs extraction: calendar ics writer. No shared ICS writer was found in packages;
  solid-dav-bridge supplies a parser, not a writer. `eventToIcs` is deferred with the UI action.
- All-day date/dateTime choice: generator closed admission rejects sh:or.
- Audience changes and reopening cancelled/postponed replies.
- ACP/LWS sharing, own-pod authorship verification and cross-device anonymous receipts.
- Durable offline writes and transactional capacity reservations.
- Email invitations.
- Reminders.
- Ticketing.
- Co-hosts.
- Comments thread.

Invitee notification delivery is available through pod-access/notify as an explicit organiser action.
Before merging, the lead must arrange the code-quality process's Claude review of this new package.
