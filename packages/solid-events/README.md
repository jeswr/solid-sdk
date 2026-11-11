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
availability. The profile header lists these changes. All-day invitations are deferred. Agent-or-name
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

Sharing and publication are fixed after creation in this first cut. Publishing is a multi-resource
operation: a failed creation may leave a recoverable private draft in the organiser's pod, and a failed
publication may leave some of the intended audience's grants applied. It never grants a wider audience.

`publicEventFetch` wraps the caller's credential-bounded transport with guarded-fetch and refuses redirects.
Foreign URLs are read only in the browser. Node consumers must inject a DNS-pinned transport according to
guarded-fetch's contract. Remote descriptions are plain text. Remote images are stored but not loaded.

Replies, agent WebIDs and times are **self-reported claims**, not verified identities. Guest keys distinguish
anonymous people with identical display names. The latest timestamp wins per agent/key, with lexical URL
ties for deterministic order; late latest replies are flagged and included. Only Yes replies contribute
plus-guests. Capacity is advisory, never an atomic reservation or a guarantee that no other reply raced.
A hidden list provides no public tally. Guest receipt state is local to that browser and account/event;
clearing browser storage loses anonymous change-reply continuity. The first cut has no durable write outbox.

## Deferred

- Add to calendar: needs extraction: calendar ics writer. No shared ICS writer was found in packages;
  solid-dav-bridge supplies a parser, not a writer. `eventToIcs` is deferred with the UI action.
- All-day date/dateTime choice: generator closed admission rejects sh:or.
- Safe audience changes/revocation and draft publication after creation.
- ACP/LWS sharing, verified reply authorship and cross-device anonymous receipts.
- Durable offline writes, large-list pagination and transactional capacity reservations.
- Email invitations.
- Reminders.
- Ticketing.
- Co-hosts.
- Comments thread.

Invitee notification delivery is available through pod-access/notify as an explicit organiser action.
Before merging, the lead must arrange the code-quality process's Claude review of this new package.
