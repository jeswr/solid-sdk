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
  { slug: "calendar", name: "Calendar" },
  { slug: "contacts", name: "Contacts" },
  { slug: "notes", name: "Notes" },
  { slug: "photos", name: "Photos" },
  { slug: "chat", name: "Chat" },
  { slug: "sheets", name: "Sheets" },
  { slug: "mail", name: "Mail" },
  { slug: "music", name: "Music" },
  { slug: "money", name: "Money" },
  { slug: "health", name: "Health" },
  { slug: "bookmarks", name: "Bookmarks" },
  { slug: "insights", name: "Insights" },
  { slug: "forms", name: "Forms" },
  { slug: "recipes", name: "Recipes" },
  { slug: "media", name: "Media" },
  { slug: "journal", name: "Journal" },
  { slug: "events", name: "Events" },
  { slug: "whiteboard", name: "Whiteboard" },
  { slug: "wallet", name: "Wallet" },
  { slug: "places", name: "Places" },
  { slug: "slides", name: "Slides" },
  { slug: "publish", name: "Publish" },
  { slug: "trips", name: "Trips" },
  { slug: "ask", name: "Ask" },
];
