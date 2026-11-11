<!-- AUTHORED-BY Claude Opus 5.5 -->
# Pilot feedback interview

The suite asks pilot participants for feedback through a short interview led by an LLM
(`/feedback`). This record says how the interview is built and why. The questions
themselves live in `src/feedback/guide.ts`; keep the two in step.

## What the interview borrows, and from where

| Practice | What we take from it |
| --- | --- |
| **User-centred design** (ISO 9241-210; semi-structured interviews) | Open, neutral questions; one at a time; the participant's own words; probe for specifics ("can you give me an example?"); never defend the product. |
| **Critical incident technique** (Flanagan, 1954) | Ask for one concrete moment that went well and one that went badly, then what they expected, what happened and what they did next. Specific stories beat general opinions. |
| **Retrospective think-aloud** | Ask them to walk back through what they did first and next, app by app. We know which apps they tried from the walkthrough, so we ask only about those. |
| **Single Ease Question** (SEQ, Sauro and Dumas, 2009) | One 1 to 7 rating per app they tried ("overall, how easy or difficult was it?"), followed by "why that number?". Cheap, comparable across apps and rounds. |
| **UMUX-Lite** (Lewis, Utesch and Maher, 2013) | Two 1 to 7 agreement items for the whole suite: "its capabilities meet my needs" and "it is easy to use". It tracks SUS closely with two items instead of ten, which suits a conversation. |
| **Value Sensitive Design** (Friedman, Kahn and Borning; Friedman and Hendry, 2019) | Ask about human values, not just usability: control and ownership of data, privacy, trust, autonomy, and who else is affected (indirect stakeholders such as people in your contacts, photos or shared documents). Ask where values pull against each other, such as convenience against control. |
| **Laddering** (means-end chains, Reynolds and Gutman, 1988) | When a participant names something they care about, ask "why does that matter to you?" up to twice, to climb from a feature to a consequence to a value. |
| **Jobs to be done** (switch interview, forces of progress) | "If you used this for real, what would you use it for? What would it replace? What would make you hesitate?" Push and pull, anxiety and habit. |
| **Member checking** | At the end the interviewer reads back a short summary and asks "did I get that right?" before anything is sent. |

## The interview, stage by stage

About ten minutes. The interviewer may skip or merge questions the participant has already
answered, and every question can be skipped.

1. **Opening.** Thanks, how long it takes, that honest criticism is the most useful thing,
   that it can be typed or spoken, and that nothing is sent until they press Submit.
2. **Context.** What they do day to day with documents, files, tasks and calendars, and
   which tools they use now. Which device they used for the pilot.
3. **Walk back through it.** "Tell me what you did first, and then what." Per app they
   tried: SEQ rating, then "why that number?".
4. **Critical incidents.** One moment it worked well. One moment they got stuck, confused
   or surprised: what they expected, what happened, what they did next.
5. **Values.** Your data is kept in a pod you control: what, if anything, does that mean
   to you? Did you feel in control of who could see your things? Who else is affected by
   what you store or share here? Was anything a trade-off between convenience and control?
   Ladder once or twice on anything they say they care about.
6. **Value for them.** What would they use it for for real, what would it replace, what
   would stop them switching.
7. **Overall.** UMUX-Lite (two ratings). The one thing they would change. Anything else.
8. **Read-back and close.** Three to five bullets of what was heard, "did I get that
   right?", corrections folded in, then the record is ready to submit.

A **quick note** pathway skips the stages: the participant reports a bug, an idea or a
confusing moment in their own words, and the interviewer asks at most two follow-ups
(where it happened, what they expected).

## How the interviewer behaves

- One question per message, a few sentences at most; plain English.
- Neutral wording: "how easy or difficult", never "how easy".
- At most two follow-ups per topic, then move on; respect "skip" and "that's all".
- Record ratings as numbers and everything else in the participant's words.
- Never argue, defend, explain the product or promise fixes.
- Never ask for personal data beyond an optional contact email at the end. If the
  participant shares something sensitive, the summary leaves it out.

## What gets recorded

One record per interview: the pathway, the apps tried (from the walkthrough), SEQ per app,
UMUX-Lite, the critical incidents, the values said to matter (with their ladders), the jobs
to be done, the one change, free comments, the read-back summary as confirmed, and the full
transcript. Voice answers are transcribed where the browser can, and the recordings are kept with the record so the team can listen to them.

## Sources

- ISO 9241-210:2019, Human-centred design for interactive systems.
- J. C. Flanagan (1954), The critical incident technique. Psychological Bulletin 51(4).
- J. Sauro and J. S. Dumas (2009), Comparison of three one-question, post-task usability
  questionnaires. CHI 2009.
- J. R. Lewis, B. S. Utesch and D. E. Maher (2013), UMUX-LITE: when there's no time for the
  SUS. CHI 2013.
- B. Friedman and D. G. Hendry (2019), Value Sensitive Design: Shaping Technology with Moral
  Imagination. MIT Press.
- T. J. Reynolds and J. Gutman (1988), Laddering theory, method, analysis, and
  interpretation. Journal of Advertising Research 28(1).
- B. Moesta and C. Spiek, the jobs-to-be-done switch interview (forces of progress).
