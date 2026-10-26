<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Calendar invitations (CAL-L6)

Pure state transitions and transport-independent message plans. Import the `index.ts` barrel.
No React, clock, network, RDF, ICS parser/serializer, or new dependencies.

- `createInvitation({ uid, organizer, attendees })` creates sequence zero; attendees have an
  explicit standard iCalendar role and begin at `NEEDS-ACTION`.
- `planInvite(state, actor, dtstamp)` produces a REQUEST for the current sequence, including
  all attendees, without editing state. Repeating it can retransmit the same revision.
- `setAttendees(state, actor, members, dtstamp)` allows only the organizer to replace membership
  and roles. It advances the sequence, preserves retained RSVP statuses, clears their per-revision
  reply stamps, and initializes additions at `NEEDS-ACTION`. Removed members get CANCEL; the
  remaining set gets REQUEST. Even an unchanged set is an explicit new revision.
- `planReply(state, actor, status, dtstamp)` produces a REPLY from that attendee to the organizer
  at the current sequence. `applyReply(state, authenticatedSender, reply)` applies only that
  sender's status. REPLY cannot edit roles or membership and never advances the sequence.
- `applyReply` returns `applied` or `ignored-stale`. Lower sequences (including removed attendees'
  replies) and older/equal DTSTAMP at the same sequence are ignored. Future sequences, wrong
  event/organizer/recipient, impersonation, and current-sequence nonmembers are typed errors.
- `cancelInvitation(state, actor, dtstamp)` allows only the organizer, advances the sequence,
  marks the event cancelled, and plans CANCEL to all attendees. Cancellation is terminal; old
  replies remain ignorable. `summarizeInvitation` counts all five statuses, always including zeros.

All operations validate input and return independent data without mutating input. `InvitationError`
exposes a stable `code` and a message that contains no input values. Plain records with exactly the
specified fields are required; unknown extensions are rejected. Identities must be canonical,
credential-free absolute HTTP(S) WebIDs; no email resolution or URI normalization occurs. Sequence
is an integer in 0…2147483647. DTSTAMP is `YYYY-MM-DDTHH:mm:ssZ`, years 0001…9999; offsets,
fractions, invalid dates, and leap seconds are rejected. Persisted state must retain `repliedAt`
so duplicate and out-of-order replies remain ignorable after reload.

The adapter must authenticate the supplied actor independently of message fields and enforce
storage authorization/concurrency. These plans cover whole-event invitation metadata only; an
adapter combines them with event details and handles sharing/notifications, serialization and
transport. A CANCEL recipient list from `setAttendees` removes those recipients; it does not mark
the organizer's event cancelled. `DELEGATED` is an RSVP status only, with no delegation transfer
or attendee-set mutation. Recurrence-instance messages, delegation targets, proxy actors, and
additional iTIP methods are unsupported rather than silently interpreted.

Semantics reference: [RFC 5546 §§2.1.5, 3.2.2, 3.2.3, 3.2.5](https://www.rfc-editor.org/rfc/rfc5546.html)
and [RFC 5545 §§3.2.12, 3.2.16, 3.8.7.4](https://www.rfc-editor.org/rfc/rfc5545.html).
The conservative scope choices are recorded in root `QUESTIONS.md`.
