// AUTHORED-BY Codex GPT-6.1-Sol
import type { SuiteNotification } from "../../shell/lib/notifications-model";

/** The shell's demo source uses the same account clock as the in-browser pod. */
export function seedDigestNotifications(now: Date): SuiteNotification[] {
  return [
    ...Array.from(
      { length: 4 },
      (_, i): SuiteNotification => ({
        id: `demo-agent-action-${i}`,
        kind: "task",
        app: "agent",
        category: "agent-action",
        title: [
          "Your agent organised your inbox",
          "Your agent prepared a reply",
          "Your agent updated your plan",
          "Your agent filed a receipt",
        ][i] as string,
        href: "/agent/activity",
        target: { id: "demo-agent-actions", title: "Agent activity" },
        createdAt: new Date(now.getTime() - (i + 1) * 60000),
        read: true,
      }),
    ),
    {
      id: "demo-agent-approval",
      kind: "task",
      app: "agent",
      category: "agent-approval",
      blocking: true,
      title: "Your agent needs approval to send a reply",
      href: "/agent/approvals",
      createdAt: new Date(now.getTime() - 30000),
      read: false,
    },
  ];
}

/** Keep seeded event times stable so saved summary links survive a full page reload. */
export function demoNotificationDate(accountId: string, now = new Date()): Date {
  const key = `suite.notification-demo-clock.v1.${accountId}`;
  try {
    const saved = localStorage.getItem(key);
    const time = saved === null ? NaN : Number(saved);
    if (Number.isFinite(time) && time > 0 && time <= now.getTime()) return new Date(time);
    localStorage.setItem(key, String(now.getTime()));
  } catch {
    /* Demo events still work for this visit when persistence is unavailable. */
  }
  return now;
}
