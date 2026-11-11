// AUTHORED-BY Codex GPT-6.1-Sol
import { feedbackApps } from "./apps";

export type Pathway = "guided" | "quick";
export type Answer = string | number | string[];
export type Answers = Record<string, Answer>;
export interface Question {
  id: string;
  stage: number;
  text: string;
  type: "text" | "scale" | "choice" | "multi";
  options?: { value: string; label: string }[];
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  optional?: boolean;
  app?: string;
}
export const stages = [
  "Opening",
  "Context",
  "Walk back through it",
  "Critical incidents",
  "Values",
  "Value for you",
  "Overall",
  "Read-back and close",
] as const;
export const opening =
  "Thank you for trying the Solid Suite. This takes about ten minutes. Honest criticism helps us most. You can type or speak, and skip any question. Recordings are saved privately when you stop recording. Press Submit to send your interview record to the suite team. The interviewer processes each answer as you send it.";
const text = (id: string, stage: number, content: string, optional = false): Question => ({
  id,
  stage,
  text: content,
  type: "text",
  optional,
});
const scale = (
  id: string,
  stage: number,
  content: string,
  max = 7,
  minLabel = "Strongly disagree",
  maxLabel = "Strongly agree",
): Question => ({ id, stage, text: content, type: "scale", max, minLabel, maxLabel });
export const questions: Question[] = [
  text("context_work", 1, "What do you do day to day with documents, files, tasks and calendars?"),
  text("context_tools", 1, "Which tools do you use for those things now?"),
  text("context_device", 1, "Which device did you use to try the suite?"),
  {
    id: "apps",
    stage: 2,
    text: "Which apps did you try today? Check the walkthrough suggestions and change them if needed.",
    type: "multi",
    options: feedbackApps.map((a) => ({ value: a.slug, label: a.name })),
  },
  {
    id: "pod",
    stage: 2,
    text: "Did you use the demo pod or your own pod?",
    type: "choice",
    options: ["Demo pod", "My own pod", "Both", "Not sure"].map((value) => ({
      value,
      label: value,
    })),
  },
  {
    id: "debrief_apps",
    stage: 2,
    text: "You tried more than four apps. Which four would you like to talk about?",
    type: "multi",
    max: 4,
    options: feedbackApps.map((a) => ({ value: a.slug, label: a.name })),
  },
  ...feedbackApps.flatMap((a) => [
    {
      ...text(
        `recall_${a.slug}`,
        2,
        `Thinking back to ${a.name}, tell me what you did first, and then what.`,
      ),
      app: a.slug,
    },
    {
      ...scale(
        `seq_${a.slug}`,
        2,
        `Overall, how easy or difficult was what you tried in ${a.name}?`,
        7,
        "Very difficult",
        "Very easy",
      ),
      app: a.slug,
    },
    { ...text(`seq_reason_${a.slug}`, 2, "Why that number?"), app: a.slug },
  ]),
  text(
    "incident_best",
    3,
    "Tell me about one moment it worked well. What did you expect, what happened and what did you do next?",
  ),
  text(
    "incident_stuck",
    3,
    "Tell me about one moment you got stuck, confused or surprised. What did you expect, what happened and what did you do next?",
  ),
  text(
    "values_control",
    4,
    "Your data is kept in a pod you control. What, if anything, does that mean to you?",
  ),
  text("values_permissions", 4, "Did you feel in control of who could see your things?"),
  text("values_stakeholders", 4, "Who else would be affected by what you store or share here?"),
  text("values_tradeoff", 4, "Was anything a trade-off between convenience and control?"),
  text(
    "values_ladders",
    4,
    "Thinking of something you said you care about, why does that matter to you?",
    true,
  ),
  text("jobs_use", 5, "If you used this for real, what would you use it for?"),
  text("jobs_replace", 5, "What would it replace?"),
  text("jobs_hesitate", 5, "What would stop you switching?"),
  scale("umux_capabilities", 6, "The suite's capabilities meet my requirements."),
  scale("umux_ease", 6, "The suite is easy to use."),
  scale(
    "likelihood",
    6,
    "How likely are you to use it for real?",
    5,
    "Very unlikely",
    "Very likely",
  ),
  text("one_change", 6, "What is the one thing you would change first?"),
  text("comments", 6, "Anything else?", true),
  text("general", 0, "Tell us about a bug, an idea or a confusing moment in your own words."),
  {
    id: "confirmed",
    stage: 7,
    text: "Did I get that right? You can type corrections, or confirm the read-back.",
    type: "choice",
    options: [{ value: "yes", label: "Yes, that's right" }],
  },
];
export const questionById = (id: string) => questions.find((q) => q.id === id);
export function interviewPlan(answers: Answers): Question[] {
  const apps = Array.isArray(answers.apps) ? answers.apps : [];
  const selected = Array.isArray(answers.debrief_apps)
    ? answers.debrief_apps.filter((a) => apps.includes(a)).slice(0, 4)
    : apps.slice(0, 4);
  return questions.filter(
    (q) =>
      q.id !== "general" &&
      (q.id !== "debrief_apps" || apps.length > 4) &&
      (!q.app || selected.includes(q.app)),
  );
}
export function readWalkthrough(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      !("done" in value) ||
      !Array.isArray(value.done) ||
      !value.done.every((v) => typeof v === "string")
    )
      return [];
    return [...new Set(value.done.filter((id) => feedbackApps.some((a) => a.slug === id)))];
  } catch {
    return [];
  }
}
