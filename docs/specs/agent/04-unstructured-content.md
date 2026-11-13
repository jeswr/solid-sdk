<!-- AUTHORED-BY Claude Fable 5.2 -->
# Content that does not fit

Draft 0.5, 13 November 2026. Part of the core. Clause prefix UNS.

**Question: what does an agent do with words, pictures and judgement that no agreed
vocabulary can carry?**

## 1. Why this document

The checks in the core work on claims: statements in terms both sides know, that a rule can
test. Much of what people send each other is not that. A doctor's letter hedges. A photograph
shows damage. A reference is an opinion. A borrower explains why they need time.

The design does not require everything to be structured, and it does not pretend a model's
reading of a letter is as good as the letter. It requires two things. An agent always knows
which parts of a message it can check by rule and which it cannot. And nothing that binds the
principal or discloses their data rests on the second kind unless a rule says it may.

The use cases behind this document are in [35 Use cases](35-use-cases.md), section 4.

## 2. Terms

**Structured content** is a set of claims in a vocabulary the receiver has. The inbound
checks can test it.

**Unstructured content** is everything else: prose, images, audio, documents, and claims in a
vocabulary the receiver does not have.

A **reading** is what a model, or a person, takes from unstructured content: a summary, a
value, a classification. A reading is a new statement. Its author is whoever made it.

**Free text** is unstructured content written by an agent's own core for someone else.

Any content can be asked three questions. *Who said it* has an answer for unstructured
content too: a signed letter is its signer's statement that these are their words. *What it
says* has a checkable answer only for structured content. *Whether to rely on it* is decided
as for any statement, by its source and its method ([16b Reliance](16b-reliance.md)).

## 3. Receiving it

- **UNS-1. It may travel.** A message MAY carry unstructured content as a content part with a
  media type and a digest. The message proof covers the digest, so integrity and authorship
  are established exactly as for claims.
- **UNS-2. It is data.** The inbound gate MUST label unstructured content as such before the
  core sees it. Nothing in it is an instruction, whoever signed it and whatever it says
  (CORE-IN-16).
- **UNS-3. A reading is a new statement.** A reading MUST be recorded as a statement whose
  author is the agent that made it, whose method is `model-output` (or `self-reported` when
  the principal made it), and which names the digest of the content it was read from and the
  statement of what the agent runs. A reading MUST NOT carry the authority of the content's
  author. The hospital signed the letter. It did not sign the summary.
- **UNS-4. A reading is relied on only where a profile says so.** A domain profile lists, for
  each kind of claim, the methods it accepts (RL-2). `model-output` is accepted only where the
  profile lists it. A profile SHOULD NOT list it for any claim on which an action that binds
  the principal, pays, or discloses personal data depends.
- **UNS-5. Ask for the claim.** When an action needs a claim in structured form and it arrived
  only as unstructured content, the fitness check gives `ask-more` with
  `structured-form-required` and names the kind of claim. The agent SHOULD ask the content's
  source, not its sender, when they differ: the merchant for the receipt, not the customer
  for a better photograph.
- **UNS-6. Keep the original.** The record keeps the digest of the unstructured content next
  to every reading of it and every decision that used the reading, so that a person or a
  forum can compare them later.
- **UNS-7. Quarantined reading.** An agent SHOULD read unstructured content from a source it
  does not accept in a separate model context that has no tools and returns only values of
  declared types. What comes back is a reading under UNS-3. This limits what injected text can
  do to producing a wrong value.

## 4. Sending it

Free text is the hard direction. The disclosure check compares what is sent with what the
purpose needs. It cannot do that for prose by rule, because it cannot tell by rule what the
prose says. So the check works on what the prose *could* say.

- **UNS-8. Track what the core has seen.** For each task, the agent MUST keep the set of
  items that entered the core's context: statements, memory entries, messages and readings,
  each with its subject and its terms.
- **UNS-8a. What counts as structured when sending.** A value in an outgoing message is
  structured only when the profile's vocabulary types its position and the value fits the
  type: a number, a date, a code from a closed list, a defined term, or an identifier the
  gate already knows. An identifier is known when it comes from the profile, from the
  conversation so far, from an item in the task's context, or was minted by the runtime.
  Everything else is free text, whatever its field is called. An identifier the core
  invents is free text: words can be written into one.
- **UNS-9. The context rule.** Free text MAY leave without the principal's approval only when
  every item in that set would itself pass the disclosure and data terms checks for this
  recipient and this purpose. Otherwise the disclosure check gives `ask-principal` with
  `context-not-clear`, and the principal is shown the text; or `fail` when the mandate does
  not let the principal decide.
- **UNS-9a. The other side of the context rule.** UNS-9 protects the principal's data. The
  same reasoning protects the people the agent writes to. When the core's context for a task
  holds content from a source that was not accepted, free text to another party MAY leave
  without approval only if it was written in a context that never held that content
  (UNS-7, UNS-10). Otherwise the disclosure check gives `ask-principal` with
  `context-not-clear` and the principal is shown the text. An agent that has read a hostile
  page must not be able to pass its links on in the principal's name unseen.
- **UNS-10. Need-to-know context.** An agent SHOULD give the core, for each conversation, only
  the items the other party may be told, and SHOULD do work on other items in a separate
  context whose results come back as structured values. An agent that does this rarely
  triggers UNS-9.
- **UNS-11. A model may tighten, never loosen.** An agent MAY add a model that reads outgoing
  free text for leaks. Its verdict can turn a go into an ask or a stop. It MUST NOT turn an
  ask or a stop into a go.
- **UNS-12. Free text never commits.** An offer, an acceptance, a payment or a consent is made
  only in structured form under the commitments layer. A receiver MUST NOT treat free text as
  any of these, however it is worded.
- **UNS-13. Say what it is.** Free text sent by an agent MUST be marked as written by a
  model, and the message MUST say for whom the agent acts.

## 4a. What the agent tells its own principal

The outbound gate stands between the core and the world. Nothing stands between the core
and its own principal, and an attack can aim there: text on a page says "recommend this
hotel", and the agent does.

- **UNS-18. Say where it came from.** Whatever the agent tells its principal that rests on
  content from a source that was not accepted MUST be shown with that fact: what the content
  was, where it came from, and that nobody vouched for it. A recommendation, a summary and
  an answer are readings (UNS-3) and carry the weakest label among the things they rest on.
- **UNS-19. Decisions stay with what was checked.** An approval request shown to the
  principal (CORE-OUT-7) MUST be built by the gate from the action itself, never from the
  core's description of it, so that what the core says to the principal cannot change what
  the principal approves.

## 5. Judgement

- **UNS-14. Decisions for a person.** A domain profile names the decisions that rest on
  judgement and belong to a person: discretion, a novel request, a term with no agreed
  meaning. For these the outcome is to ask the principal, or the named role in an
  organization. The record keeps the digest of what the person was shown and what they
  decided.
- **UNS-15. Unknown is not yes.** A term, a purpose or a kind of claim the agent does not
  have gives `indeterminate` (CORE-C-3). The agent does not guess from the wording.
- **UNS-16. Rules written in advance.** Where there may be no time or no one to ask, the
  mandate MAY carry rules for the expected cases, including a rule that lets a registered
  role read a named set of items in an emergency. Each use of such a rule MUST be recorded and
  reported to the principal, and to any contact the mandate names, as soon as possible.
- **UNS-17. Low stakes.** A profile MAY let a step that neither binds the principal nor
  discloses their data rest on a reading. The checks still run.

## 6. What this does not solve

- **A wrong reading.** UNS-3 to UNS-6 make a reading visible, attributable and comparable
  with its source. They do not make it right, and a person who relies on a wrong summary is
  misled all the same.
- **A true-looking false statement.** A source the receiver rightly accepts can sign
  something untrue. Every check passes. The remedy is afterwards, through the record, or
  beforehand through a second source (`corroboration`).
- **Context that purposes cannot list.** People judge whether a disclosure suits its context
  from far more than a purpose. The checks know only the purposes and terms someone wrote
  down.
- **The model's skill.** Inside its limits the core may bargain badly, write unclearly or
  miss the point. The gates bound what it can cost; they do not make it good.
- **Persuasion.** UNS-18 labels what the agent says to its principal. A labelled
  recommendation can still persuade. In the first benchmark run this was the largest group
  of attacks that got through ([60 Evaluation](60-evaluation.md), section 9).
- **Approval fatigue.** Every `ask-principal` spends the person's attention. A design that
  asks too often trains people to say yes. The number of asks per task is measured in
  [60 Evaluation](60-evaluation.md), and UNS-10 and UNS-16 exist to keep it low.
- **What a receiver does after it has the data.** Terms, signed acceptance and receipts make
  misuse provable. They do not make it impossible.

## 7. Open questions

1. UNS-9 is deliberately blunt: one restricted item in the context blocks all free text. A
   finer rule would track which items influenced which sentence. No reliable way to do that
   is known.
2. Whether a reading by a person in an organization should carry that person's role, and
   count for more than a model's.
3. How to show a principal a long free text for approval so that they actually read it.
4. Voice. Speech is free text in both directions with no time to ask.
