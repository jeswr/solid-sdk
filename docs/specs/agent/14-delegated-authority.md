<!-- AUTHORED-BY Claude Fable 5.2 -->
# Delegated authority

Draft 0.4, 13 November 2026. Layer 2 of the paper's seven gaps.

**Question: may this agent do this for this person?**

## What this layer decides

An agent says it acts for Sam. A delegated authority suite says how that is shown: what Sam
signed, what it allows, how a receiver follows it back to Sam, how sure the receiver can be
that Sam really approved it, and how it is withdrawn.

The core keeps four things apart that are often run together (CORE-D-3). Representation:
this agent acts for Sam. Authorization: Sam allows this action. Trust: the receiver's view of
Sam or the agent. Competence: whether Sam is someone who can do this at all, such as a
company officer who can bind the company. A suite in this layer covers the first two. The
trust framework layer covers the third, and a domain profile states the fourth.

## What a delegated authority suite must define

- **AU-1. The mandate.** What is signed: which actions, for which purposes, with which
  parties or kinds of party, within which limits, from when until when, and which actions
  need the principal's approval first. In ODRL's words the principal is the assigner and the
  agent is the assignee.
- **AU-2. Who can grant.** Whose signature makes a mandate effective, and how the receiver
  ties that signature to the principal.
- **AU-3. Binding to the agent.** How the mandate is tied to the agent's key, so that a
  copied mandate is useless to another agent.
- **AU-4. Approval and its strength.** How the mandate records the way the principal
  approved it, and the levels of approval the suite can express.
- **AU-5. Asking for more.** How a receiver states the level it requires for an action, and
  how an agent obtains and presents a stronger approval.
- **AU-6. Passing it on.** Whether an agent can delegate further, and the rule that what is
  passed on is never wider than what is held (CORE-S-3). Each link in a chain is named.
- **AU-7. Status.** How a mandate is suspended or withdrawn, how a receiver checks, and how
  fresh the answer must be (CORE-S-1).
- **AU-8. What it reveals.** What a receiver learns about the principal from the mandate
  beyond what the action needs.

## Which checks draw on it

Inbound authority, on the receiving side. Outbound mandate, and limits and approval, on the
sending side. The same mandate is read by both: the agent's own outbound gate enforces it,
and the receiver's inbound gate verifies it.

## Suites

| Suite | Name | Status | Builds on | Maturity of what it builds on |
|---|---|---|---|---|
| `mandate-signed` | Signed mandate, stronger approval on request | Baseline | ODRL 2.2 in a JWS; RFC 9470; WebAuthn | Standard |
| `mandate-credential` | Mandate as a verifiable credential | Defined | Verifiable Credentials 2.0; Bitstring Status List | Standard |
| `authorization-server` | Grant from an authorization server | Sketch | RFC 9396, RFC 8693, or GNAP (RFC 9635) | Standard |
| `agent-registry` | Agent registry | Sketch | Agent registries | Draft |

### `mandate-signed`

The mandate is an ODRL policy, signed as a JWS with a key the principal controls. It names
the agent by its key thumbprint (AU-3), lists permissions and prohibitions, and marks the
actions that need approval first. It has a start and an end.

**Approval levels.** The mandate carries an approval statement saying how the principal
approved it. Three levels are defined:

| Level | Meaning | Evidence |
|---|---|---|
| `declared` | The principal's key signed it. Nothing shows how the key was unlocked. | The signature |
| `user-verified` | The principal unlocked the key with something only they have or are, on their own device | A passkey assertion with user verification |
| `attested` | An identity provider the receiver accepts attests that this person approved this mandate, by a stated method such as a certified face check | The provider's signed attestation, naming the mandate by digest, the method and the time |

**Asking for more.** A receiver sets the level it needs for each kind of action. When the
level presented is too low, the authority verdict is `ask-more` with reason
`assurance-insufficient`, and the receiver sends a `challenge` naming the level and the
methods it accepts. The agent's outbound gate treats getting a stronger approval as an action
that needs the principal: it asks them, in words built by the gate, to approve the same
mandate at that level. The new approval statement is attached and the request is sent again
with the same content and a new message identifier.

The receiver checks the identity provider through its trust framework suite, like any other
source: is this provider accepted for attesting approvals at this level.

**Status.** A mandate ends at its end date. To end it sooner the principal signs a
withdrawal, which the agent's own gate obeys at once (CORE-OUT-10) and which is published
where the mandate says status can be checked. A receiver checks status before any action
with lasting effect.

**What it reveals.** The whole mandate is shown to each receiver. A principal who does not
want a lender to see that the agent may also deal with other lenders needs one mandate per
relationship, or the credential suite with selective disclosure.

### `mandate-credential`

The same ODRL policy is the subject of a verifiable credential issued by the principal, or
by an identity provider on the principal's instruction. Status uses a status list with
`suspension` and `revocation`, so a mandate can be paused and resumed. With a selective
disclosure suite in the authenticity layer, the agent shows a receiver only the permissions
that concern it. A delegation chain is a chain of credentials, each naming the one above it.

### `authorization-server`

The principal approves at an authorization server they already use, such as their bank's or
their pod provider's. The server issues a grant that names the actions allowed in structured
form (rich authorization requests, or a GNAP access request), bound to the agent's key. A
chain of delegation uses the nested actor claim of token exchange. The agent acts for the
principal and is never issued a token that makes it appear to be the principal.

This is the route most organizations can adopt soonest, because they run such servers today.
Its limit is that the receiver must accept the server, so it suits exchanges inside one
trust domain better than exchanges between strangers. Sketch only.

### `agent-registry`

A registry links each registered agent to the person or organization behind it and states
what it is registered to do. The receiver looks the agent up and treats the entry as the
statement of authority. This moves the question to the trust framework layer: is this
registry accepted for this kind of agent. Registries of agents are at draft and vendor stage,
and this suite is a sketch that records where they would fit.

## Notes on approval by a person

Not normative. Approval fatigue is a known failure: a person asked too often approves
without reading. The mandate is the main defense, because it lets routine actions go without
asking. Beyond that, an implementation should group requests where the rule allows, should
rank them by what is at stake, and should never show the principal text written by the core
(CORE-OUT-7).

## Open questions

- A common way to write approval levels that lines up with national schemes (the levels of
  assurance in eIDAS, the UK trust framework's levels of confidence).
- Whether a mandate should be opened as a set of constraints and closed as the final agreed
  terms, as payment protocols for agents now do. This sits between this layer and
  commitments.
