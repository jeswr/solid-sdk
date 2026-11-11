// AUTHORED-BY Codex GPT-6.1-Sol
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
  statusLabel: "Ready to try" | "For developers";
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

// Pages slugs match scripts/build-pages.mjs.
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
  {
    // Moved into Settings; the old Pages slug only redirects to the default deployment.
    id: "pod-migrator",
    name: "Pod migrator",
    description: "Move data between pods, from Settings.",
    href: "/settings/move-pod",
    statusLabel: "Ready to try",
  },
  companion("mcp-server", "MCP server", "Connect an assistant to your pod."),
  companion("access-manager", "Access manager", "Manage access to your pod.", true),
  companion("pod-manager", "Pod manager", "Manage pod storage and accounts."),
  companion("issues", "Issues", "Track issues using your pod."),
  companion("coeliac", "Coeliac", "Explore a pod app for coeliac health."),
  companion("agent-daemon", "Agent daemon", "Run a pod assistant in the background."),
  companion("notification-relay", "Notification relay", "Deliver pod notifications to devices."),
];
