// AUTHORED-BY Codex GPT-6.1-Sol
export const TEMPLATE_APPS = ["docs", "sheets", "notes", "tasks"] as const;
export type TemplateApp = (typeof TEMPLATE_APPS)[number];
export type TemplateContent =
  | { format: "markdown"; markdown: string }
  | { format: "grid"; rows: readonly (readonly string[])[] }
  | { format: "tasks"; sections: readonly { name: string; titles: readonly string[] }[] };
export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  app: TemplateApp;
  category: string;
  previewText: string;
  source: "builtin";
  content: TemplateContent;
}
function markdown(
  app: "docs" | "notes",
  id: string,
  name: string,
  category: string,
  body: string,
): BuiltinTemplate {
  return {
    id,
    name,
    app,
    category,
    description: `Start with ${name.toLowerCase()}.`,
    previewText: body,
    source: "builtin",
    content: { format: "markdown", markdown: body },
  };
}
function grid(id: string, name: string, category: string, rows: string[][]): BuiltinTemplate {
  return {
    id,
    name,
    app: "sheets",
    category,
    description: `Organise your ${name.toLowerCase()}.`,
    previewText: rows.map((row) => row.join(" · ")).join("\n"),
    source: "builtin",
    content: { format: "grid", rows },
  };
}
function tasks(
  id: string,
  name: string,
  sections: { name: string; titles: string[] }[],
): BuiltinTemplate {
  return {
    id,
    name,
    app: "tasks",
    category: "Planning",
    description: `Plan with ${name.toLowerCase()}.`,
    previewText: sections
      .map((section) => `${section.name}: ${section.titles.join(", ")}`)
      .join("\n"),
    source: "builtin",
    content: { format: "tasks", sections },
  };
}
export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
  markdown(
    "docs",
    "docs-meeting-notes",
    "Meeting notes",
    "Work",
    "# Meeting notes\n\n## Attendees\n\nAdd attendees here.\n\n## Agenda\n\n- Updates\n- Discussion\n\n## Action items\n\n- Owner and next step\n",
  ),
  markdown(
    "docs",
    "docs-project-brief",
    "Project brief",
    "Work",
    "# Project brief\n\n## Overview\n\nDescribe the project.\n\n## Goals\n\n- Define success\n\n## Timeline\n\nAdd milestones.\n",
  ),
  markdown(
    "docs",
    "docs-letter",
    "Letter",
    "Personal",
    "# Letter\n\nYour name\n\nDate\n\nDear recipient,\n\nWrite your message here.\n\nKind regards,\n\nYour name\n",
  ),
  markdown(
    "docs",
    "docs-resume",
    "Resume",
    "Personal",
    "# Your name\n\nEmail and phone\n\n## Experience\n\n### Role and organisation\n\n- Describe an achievement\n\n## Education\n\nQualification and institution\n\n## Skills\n\n- Add a skill\n",
  ),
  grid("sheets-budget", "Budget", "Personal", [
    ["Category", "Planned", "Actual"],
    ["Income", "3000", "3000"],
    ["Housing", "1000", "950"],
    ["Food", "400", "350"],
    ["Transport", "200", "180"],
  ]),
  grid("sheets-weekly-schedule", "Weekly schedule", "Planning", [
    ["Time", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    ["09:00", "Planning", "", "", "", ""],
    ["12:00", "Lunch", "Lunch", "Lunch", "Lunch", "Lunch"],
    ["15:00", "", "", "", "", "Review"],
  ]),
  grid("sheets-invoice", "Invoice", "Work", [
    ["Invoice", "001", "", ""],
    ["Item", "Quantity", "Unit price", "Amount"],
    ["Service", "1", "100", "100"],
    ["Total", "", "", "100"],
  ]),
  markdown(
    "notes",
    "notes-checklist",
    "Checklist",
    "Personal",
    "# Checklist\n\n- [ ] First item\n- [ ] Second item\n- [ ] Third item\n",
  ),
  markdown(
    "notes",
    "notes-journal",
    "Journal entry",
    "Personal",
    "# Journal entry\n\n## Today\n\nWhat happened today?\n\n## Gratitude\n\nWhat are you grateful for?\n\n## Tomorrow\n\nWhat would you like to do next?\n",
  ),
  tasks("tasks-project-plan", "Project plan", [
    { name: "Plan", titles: ["Define the goal", "Agree on scope"] },
    { name: "Do", titles: ["Build the first version", "Review with the team"] },
    { name: "Finish", titles: ["Launch", "Reflect on lessons learned"] },
  ]),
  tasks(
    "tasks-weekly-planner",
    "Weekly planner",
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((name) => ({
      name,
      titles: [`Choose ${name}'s priority`],
    })),
  ),
];
export function builtinsForApp(app: TemplateApp): readonly BuiltinTemplate[] {
  return BUILTIN_TEMPLATES.filter((template) => template.app === app);
}
