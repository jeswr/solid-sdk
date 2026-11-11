// AUTHORED-BY Codex GPT-6.1-Sol
import type { AppSlug } from "@jeswr/suite-ui";

export interface WalkthroughStep {
  id: string;
  title: string;
  tasks: readonly string[];
  destinations: readonly { app?: AppSlug; label: string; href: string }[];
}

export const walkthroughSteps: readonly WalkthroughStep[] = [
  {
    id: "home",
    title: "Home",
    tasks: ["Look around the overview of your pod.", "Find the apps and recent activity."],
    destinations: [{ app: "home", label: "Home", href: "/home" }],
  },
  {
    id: "drive",
    title: "Drive",
    tasks: ["Open a folder and preview a file.", "Upload a file or make a folder, then rename it."],
    destinations: [{ app: "drive", label: "Drive", href: "/drive" }],
  },
  {
    id: "docs",
    title: "Docs",
    tasks: ["Open a document and try editing it.", "Create a document and give it a title."],
    destinations: [{ app: "docs", label: "Docs", href: "/docs" }],
  },
  {
    id: "tasks",
    title: "Tasks",
    tasks: ["Add a task to a list.", "Give it a due date and mark it complete."],
    destinations: [{ app: "tasks", label: "Tasks", href: "/tasks" }],
  },
  {
    id: "calendar",
    title: "Calendar",
    tasks: ["Browse your week and switch calendar views.", "Create an event and try moving it."],
    destinations: [{ app: "calendar", label: "Calendar", href: "/calendar" }],
  },
  {
    id: "contacts",
    title: "Contacts",
    tasks: ["Find and open a contact.", "Add a contact or edit a detail."],
    destinations: [{ app: "contacts", label: "Contacts", href: "/contacts" }],
  },
  {
    id: "photos-music-money",
    title: "Photos, Music and Money",
    tasks: [
      "Browse photos and open an album.",
      "Play some music and try the queue.",
      "Look at accounts and transactions in Money.",
    ],
    destinations: [
      { app: "photos", label: "Photos", href: "/photos" },
      { app: "music", label: "Music", href: "/music" },
      { app: "money", label: "Money", href: "/money" },
    ],
  },
  {
    id: "permissions",
    title: "Permissions: who can see what",
    tasks: [
      "Look at who has access to a file or folder.",
      "Try changing a sharing permission and check what it allows.",
    ],
    destinations: [{ app: "permissions", label: "Permissions", href: "/permissions" }],
  },
  {
    id: "feedback",
    title: "Tell us what you think",
    tasks: [
      "Think of something that worked and something that got in the way.",
      "Give feedback through an interview or a quick note. You can type or talk.",
    ],
    destinations: [{ label: "Give feedback", href: "/feedback" }],
  },
];
