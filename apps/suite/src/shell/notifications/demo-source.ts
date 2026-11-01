// AUTHORED-BY Codex GPT-6.1-Sol
import type {
  AccessDecider,
  NotificationSource,
  SuiteNotification,
} from "../lib/notifications-model";
export function demoNotifications(now = new Date()): SuiteNotification[] {
  const earlier = new Date(now);
  earlier.setDate(earlier.getDate() - 1);
  return [
    {
      id: "demo-share",
      kind: "shared",
      title: "Avery Moss shared a folder with you",
      body: "Project plans",
      href: "/drive/shared",
      createdAt: now,
      read: false,
      actor: { name: "Avery Moss" },
    },
    {
      id: "demo-request",
      kind: "access-request",
      title: "Rowan Vale requested access",
      body: "Q3 budget.xlsx",
      createdAt: new Date(now.getTime() - 1),
      read: false,
      actor: { name: "Rowan Vale", webId: "https://rowan.example.org/profile#me" },
      request: {
        id: "request-budget",
        resource: "https://demo.example.org/finance/Q3%20budget.xlsx",
        resourceName: "Q3 budget.xlsx",
        roles: ["viewer", "commenter", "editor"],
        purpose: "Prepare the quarterly review",
      },
    },
    {
      id: "demo-comment",
      kind: "comment",
      title: "Avery Moss mentioned you in a comment",
      body: "Could you check the latest draft?",
      href: "/docs",
      createdAt: now,
      read: false,
      actor: { name: "Avery Moss" },
    },
    {
      id: "demo-task",
      kind: "task",
      title: "Your quarterly review is due today",
      href: "/tasks/today",
      createdAt: now,
      read: false,
    },
    {
      id: "demo-storage",
      kind: "storage",
      title: "Your pod is 90% full",
      href: "/settings/storage",
      createdAt: earlier,
      read: true,
    },
    {
      id: "demo-system",
      kind: "system",
      title: "A new version is available",
      createdAt: earlier,
      read: true,
    },
  ];
}
export function createDemoNotificationSource(now = new Date()): NotificationSource & AccessDecider {
  let items = demoNotifications(now);
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    id: "demo",
    async list(signal) {
      signal.throwIfAborted();
      return structuredClone(items);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async markRead(ids) {
      items = items.map((item) => (ids.includes(item.id) ? { ...item, read: true } : item));
      changed();
    },
    async decide(request, decision) {
      items = items.map((item) =>
        item.request?.id === request.id
          ? {
              ...item,
              read: true,
              outcome: decision.approve
                ? `Approved for ${decision.role.charAt(0).toUpperCase() + decision.role.slice(1)}`
                : "Denied",
            }
          : item,
      );
      changed();
    },
  };
}
