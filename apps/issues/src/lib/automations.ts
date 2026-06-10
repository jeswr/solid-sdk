import type { IssueRecord } from "./repository";

/**
 * Built-in automations ("when X then Y", Monday/Jira-style). Pods have no
 * server-side compute, so rules run in the app whenever fresh issue state is
 * observed — the honest pure-Solid translation of an automation engine.
 */
export interface AutomationSettings {
  /** Close a parent when all of its sub-tasks are done. */
  closeParentWhenChildrenDone: boolean;
  /** Raise open overdue issues to high priority. */
  raiseOverdueToHigh: boolean;
}

export const DEFAULT_AUTOMATIONS: AutomationSettings = {
  closeParentWhenChildrenDone: false,
  raiseOverdueToHigh: false,
};

export const AUTOMATION_DEFS: { key: keyof AutomationSettings; label: string; description: string }[] = [
  {
    key: "closeParentWhenChildrenDone",
    label: "Complete parents automatically",
    description: "When every sub-task of an issue is done, mark the parent done too.",
  },
  {
    key: "raiseOverdueToHigh",
    label: "Escalate overdue issues",
    description: "When an open issue passes its due date, raise its priority to high.",
  },
];

export type AutomationAction =
  | { kind: "set-status-done"; url: string; title: string; reason: string }
  | { kind: "set-priority-high"; url: string; title: string; reason: string };

/** Evaluate the enabled rules against current state (pure; no side effects). */
export function evaluateAutomations(
  issues: IssueRecord[],
  settings: AutomationSettings,
  now = new Date(),
): AutomationAction[] {
  const actions: AutomationAction[] = [];

  if (settings.closeParentWhenChildrenDone) {
    for (const parent of issues) {
      if (parent.status === "done" || !parent.canWrite) continue;
      const children = issues.filter((i) => i.parent === parent.url);
      if (children.length > 0 && children.every((c) => c.status === "done")) {
        actions.push({
          kind: "set-status-done",
          url: parent.url,
          title: parent.title,
          reason: "all sub-tasks are done",
        });
      }
    }
  }

  if (settings.raiseOverdueToHigh) {
    for (const issue of issues) {
      if (issue.state !== "open" || !issue.canWrite || issue.priority === "high") continue;
      if (issue.dateDue && issue.dateDue.getTime() < now.getTime()) {
        actions.push({
          kind: "set-priority-high",
          url: issue.url,
          title: issue.title,
          reason: "past its due date",
        });
      }
    }
  }

  return actions;
}

const KEY = "solid-issues:automations";

export function loadAutomationSettings(storage: Pick<Storage, "getItem"> = globalThis.localStorage): AutomationSettings {
  try {
    const raw = storage.getItem(KEY);
    return raw ? { ...DEFAULT_AUTOMATIONS, ...(JSON.parse(raw) as Partial<AutomationSettings>) } : DEFAULT_AUTOMATIONS;
  } catch {
    return DEFAULT_AUTOMATIONS;
  }
}

export function saveAutomationSettings(
  settings: AutomationSettings,
  storage: Pick<Storage, "setItem"> = globalThis.localStorage,
): void {
  try {
    storage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode */
  }
}
