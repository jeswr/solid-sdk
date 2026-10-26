/**
 * A small LABELLED SYNTHETIC corpus for triage evaluation and error analysis. Every sender and
 * organisation is invented (example.* domains). Labels are the author's judgement under the
 * taxonomy; with 24 items this measures nothing about production quality.
 */
import type { PrimaryClass, Sample, UrgencyClass } from "./taxonomy.js";

export interface LabelledSample {
  id: string;
  sample: Sample;
  primary: PrimaryClass;
  urgency: UrgencyClass;
}

const s = (
  id: string,
  from: string,
  subject: string,
  body: string,
  primary: PrimaryClass,
  urgency: UrgencyClass = "not_urgent",
): LabelledSample => ({ id, sample: { from, subject, body }, primary, urgency });

export const SYNTHETIC_CORPUS: readonly LabelledSample[] = [
  s(
    "q1",
    "ana@example.org",
    "Lunch next week?",
    "Are you free for lunch on Thursday or Friday?",
    "needs_reply",
  ),
  s(
    "q2",
    "ops@example.com",
    "Room booking",
    "Could you confirm whether we still need the large room tomorrow?",
    "needs_reply",
  ),
  s(
    "q3",
    "lee@example.net",
    "Draft paper",
    "What do you think about the second section? Happy either way.",
    "needs_reply",
  ),
  s(
    "q4",
    "chair@example.org",
    "Panel today",
    "The panel starts in 2 hours and we still need your answer: can you join? Reply ASAP.",
    "needs_reply",
    "urgent",
  ),
  s(
    "a1",
    "billing@example.com",
    "Invoice 2291",
    "Please pay the attached invoice within 30 days.",
    "action",
  ),
  s(
    "a2",
    "hr@example.org",
    "Form",
    "Action required: please sign the travel form before Friday.",
    "action",
  ),
  s("a3", "portal@example.edu", "Upload", "Please upload your slides to the portal.", "action"),
  s(
    "a4",
    "it@example.com",
    "Password expiry",
    "Your access expires today. Please complete the security check immediately.",
    "action",
    "urgent",
  ),
  s(
    "w1",
    "sam@example.net",
    "Re: contract",
    "Thanks — I will get back to you once legal has reviewed it.",
    "waiting",
  ),
  s(
    "w2",
    "desk@example.org",
    "Ticket 553",
    "Your request is pending approval by the facilities team.",
    "waiting",
  ),
  s(
    "w3",
    "kai@example.com",
    "Data",
    "Still waiting for the export from the vendor; will follow up next week.",
    "waiting",
  ),
  s(
    "r1",
    "digest@example.org",
    "Monthly research digest",
    "Five new papers on knowledge graphs, summarised below.",
    "read_later",
  ),
  s(
    "r2",
    "blog@example.com",
    "Long read",
    "An essay on the history of the web, for when you have time.",
    "read_later",
  ),
  s(
    "r3",
    "team@example.net",
    "Retrospective notes",
    "Notes from last week's retrospective are in the shared folder.",
    "read_later",
  ),
  s(
    "f1",
    "pat@example.org",
    "FYI: office closed Monday",
    "FYI the office is closed on Monday for maintenance.",
    "fyi",
  ),
  s("f2", "news@example.edu", "Heads up", "Just so you know, the seminar moved to room 3.", "fyi"),
  s("f3", "bot@example.com", "Build passed", "The nightly build passed. No action needed.", "fyi"),
  s(
    "n1",
    "deals@example.com",
    "48 hours only",
    "Sale ends soon — 30% off everything! Unsubscribe here.",
    "noise",
  ),
  s(
    "n2",
    "noreply@example.net",
    "Weekly newsletter",
    "This week's newsletter. To stop these emails, unsubscribe.",
    "noise",
  ),
  s(
    "n3",
    "promo@example.org",
    "You won't believe this",
    "A special promotion just for you.",
    "noise",
  ),
  s("m1", "jo@example.org", "Quick one", "Thanks for yesterday.", "fyi"),
  s(
    "m2",
    "ren@example.com",
    "Slides",
    "Here are the slides — can you review them before the talk tonight?",
    "action",
    "urgent",
  ),
  s(
    "m3",
    "mia@example.net",
    "Visit",
    "We are waiting for you to confirm the dates, can you let me know?",
    "needs_reply",
  ),
  s(
    "m4",
    "alerts@example.com",
    "Unusual sign-in",
    "A new sign-in was detected. If this was you, no action is needed.",
    "fyi",
  ),
];
