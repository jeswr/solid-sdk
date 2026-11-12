// AUTHORED-BY Codex GPT-6.1-Sol
import type { AppSlug } from "@jeswr/suite-ui";

// The UI registry is a React client module. Keep this server-safe projection in sync
// through feedback-guide.test.ts until suite-ui exposes a shared data-only registry.
export const feedbackApps: readonly { slug: AppSlug; name: string }[] = [
  { slug: "home", name: "Home" },
  { slug: "drive", name: "Drive" },
  { slug: "docs", name: "Docs" },
  { slug: "tasks", name: "Tasks" },
  { slug: "permissions", name: "Permissions" },
  { slug: "notes", name: "Notes" },
  { slug: "calendar", name: "Calendar" },
  { slug: "contacts", name: "Contacts" },
  { slug: "photos", name: "Photos" },
  { slug: "chat", name: "Chat" },
  { slug: "sheets", name: "Sheets" },
  { slug: "mail", name: "Mail" },
  { slug: "music", name: "Music" },
  { slug: "money", name: "Money" },
  { slug: "health", name: "Health" },
];
