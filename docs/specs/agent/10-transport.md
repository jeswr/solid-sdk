<!-- AUTHORED-BY Claude Fable 5.2 -->
# Transport

Draft 0.5, 13 November 2026. Layer: plumbing.

**Question: how does a message get there?**

## What this layer decides

A transport suite says how a verifiable message is carried from one agent to another: how it
is encoded for the channel, how a reply is matched to its request, and what happens when
delivery fails. It decides nothing about whether the message is believed. Under CORE-L-8,
swapping one transport suite for another must leave every verdict the same.

That rule is the point of this layer. People already reach each other by email, chat and web
forms, and agents already talk through tool calls and task protocols. If trust depended on
the channel, every new channel would need its own security story. Here the channel is
carriage, and everything that matters is inside the signed message.

## What a transport suite must define

- **TR-1. Encoding.** How the signed message is placed in the channel, byte for byte, and how
  the receiver gets the same bytes back. If the channel can alter content, such as an email
  system that rewraps lines, the suite MUST use an encoding that survives it.
- **TR-2. One structured copy.** When a channel can carry more than one copy of a message, the
  suite MUST say which copy is authoritative. Two structured copies that differ MUST be
  refused (`conflicting-structured-copies`).
- **TR-3. Readable copy.** When people may read the channel, the suite MUST define a readable
  copy, MUST say that it is not authoritative, and MUST require the receiver to check that it
  says the same thing as the structured copy (`human-parity-mismatch`). The readable copy
  says the message was sent by an automated agent and for whom (CORE-M-10).
- **TR-4. Correlation.** How a reply is matched to a request, using identifiers inside the
  signed message and not channel features alone.
- **TR-5. Failure and retry.** What a sender does when it gets no reply, and how a retry is
  made safe. A retry MUST reuse the same message identifier so that the receiver's replay
  check treats it as the same message. A sender MUST NOT retry in a way that could cause a
  lasting effect twice.
- **TR-6. What the channel reveals.** What the channel's operator and any intermediaries can
  see: at least who is talking to whom, and when.
- **TR-7. Channel credentials.** Any credentials the channel itself needs, such as a mailbox
  login or an access token for a tool server. These authenticate to the channel only. They
  are not evidence of anything in the message, and a token issued for one server MUST NOT be
  passed on to another.
- **TR-8. Outcome mapping.** How the core outcomes (admit, ask for more, refuse) and message
  kinds map to the channel's own states, and which channel states mean nothing.

## Which checks draw on it

Integrity uses the transport suite only to recover the exact signed bytes. No other check
reads anything from the carriage.

## Suites

| Suite | Name | Status | Builds on | Maturity of what it builds on |
|---|---|---|---|---|
| `direct-http` | Direct HTTP | Baseline | HTTP | Standard |
| `a2a` | A2A | Defined | A2A 1.0 data parts | Industry specification |
| `mcp` | MCP | Defined | Model Context Protocol tool calls | Industry specification |
| `email` | Email | Defined | Internet mail, MIME | Standard |
| `solid-inbox` | Solid inbox | Sketch | Solid Protocol, Linked Web Storage | Community draft, working draft |

### `direct-http`

The sender makes an HTTPS POST to the receiver's endpoint with the signed message as the
body. The reply is the response body, or arrives later as a POST to the sender's endpoint,
matched by `inReplyTo`. HTTP status codes say only whether the bytes were received. A `200`
with a `refuse` message inside is a refusal. TLS protects the carriage in transit and is not
relied on for anything else.

### `a2a`

The signed message travels as one data part of an A2A message. The A2A task states map as
follows: `input-required` carries a `challenge`, `rejected` carries a `refuse`, `completed`
carries a `deliver` or `receipt`. The task state is a hint. The signed message inside is what
counts. An agent card is a description under CORE-L-10: a claim to be verified, not a grant.

### `mcp`

The signed message is the argument of one tool call, and the reply is the tool's result. The
tool server is a carrier. A successful tool call means only that the message was delivered.
Tokens used to reach the tool server are channel credentials under TR-7.

### `email`

The signed message is a structured MIME part of an ordinary email. The email body is the
readable copy under TR-3. Receivers MUST refuse mail with no structured part
(`no-structured-content`) when a signed message is required. Mailbox control is evidence of
mailbox control and nothing more. Forwarding, shared mailboxes and reassigned addresses are
ordinary events and MUST NOT change any verdict.

This suite is the bridge for people and organizations that have no agent yet. The baseline
document describes the path from plain email upward.

### `solid-inbox`

The sender writes the signed message as a resource in the receiver's inbox container. The
receiver's storage decides who may write there. That permission is a channel credential under
TR-7. Sketch only: no trace yet.

## Combining with other layers

Any transport suite can be combined with any suite in the other layers, with two limits. A
data access suite that sends a pointer needs a transport that can carry the pointer intact.
An identity suite that names a party by email address is usually paired with `email`, but
does not have to be.

## Open questions

- Messaging channels (Signal, Matrix, SMS, Teams) each need a suite. None is drafted.
- Whether a relay that only forwards should sign a statement of forwarding, so that delivery
  paths can be reconstructed.
