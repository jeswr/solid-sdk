// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import type { AppSlug } from "@jeswr/suite-ui";
import { appRegistry } from "../shell/registry";

const descriptions: Record<AppSlug, string> = {
  home: "See your pod, recent activity and connected apps.",
  drive: "Browse, upload and organise your files.",
  docs: "Write and edit documents in your pod.",
  tasks: "Make lists and keep track of what needs doing.",
  calendar: "Plan events and see your schedule.",
  contacts: "Keep the people you know in one place.",
  notes: "Capture ideas and quick notes.",
  photos: "Browse your pictures and organise albums.",
  chat: "Keep conversations alongside your other data.",
  sheets: "Work with tables, numbers and spreadsheets.",
  mail: "Read and organise your email.",
  music: "Explore your music and build a listening queue.",
  money: "Review accounts, transactions and budgets.",
  health: "Explore your health records and trends.",
  permissions: "Decide who can see and use your things.",
};

export const welcomeApps = appRegistry.map((app) => ({
  ...app,
  description: descriptions[app.slug],
  statusLabel: app.status === "backlog" ? "Early" : "Ready to try",
}));

export interface CompanionApp {
  id: string;
  name: string;
  description: string;
  href: string;
  statusLabel: "Ready to try" | "For developers" | "Now in Permissions";
}

function companion(id: string, name: string, description: string, pages = false): CompanionApp {
  return {
    id,
    name,
    description,
    href: pages
      ? `https://jeswr.github.io/solid-sdk/${id}/`
      : `https://github.com/jeswr/solid-sdk/tree/main/apps/${id}`,
    statusLabel: pages ? "Ready to try" : "For developers",
  };
}

// Pages slugs match scripts/build-pages.mjs, including the standalone pod migrator.
export const companionApps: readonly CompanionApp[] = [
  companion("app-store", "App Store", "Discover apps that work with your pod.", true),
  companion("pod-drive", "Pod Drive", "A standalone file browser for your pod.", true),
  companion("pod-docs", "Pod Docs", "A standalone document editor.", true),
  companion("pod-chat", "Pod Chat", "A standalone chat app.", true),
  companion("pod-mail", "Pod Mail", "A standalone email app.", true),
  companion("pod-photos", "Pod Photos", "A standalone photo library.", true),
  companion("pod-music", "Pod Music", "A standalone music player.", true),
  companion("pod-money", "Pod Money", "A standalone money manager.", true),
  companion("pod-health", "Pod Health", "A standalone health record viewer.", true),
  companion("extension", "Browser extension", "Connect your browser to your pod."),
  companion("mobile", "Mobile apps", "Use the suite on a phone or tablet."),
  companion("pod-migrator", "Pod migrator", "Move data between pods.", true),
  companion("mcp-server", "MCP server", "Connect an assistant to your pod."),
  // The standalone Access Manager moved into Permissions; its old entry point redirects there.
  {
    id: "access-manager",
    name: "Access manager",
    description: "Now part of Permissions: answer access requests and review their history.",
    href: "/permissions",
    statusLabel: "Now in Permissions",
  },
  companion("pod-manager", "Pod manager", "Manage pod storage and accounts."),
  companion("issues", "Issues", "Track issues using your pod."),
  companion("coeliac", "Coeliac", "Explore a pod app for coeliac health."),
  companion("agent-daemon", "Agent daemon", "Run a pod assistant in the background."),
  companion("notification-relay", "Notification relay", "Deliver pod notifications to devices."),
];
