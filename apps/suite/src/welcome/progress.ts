// AUTHORED-BY Codex GPT-6.1-Sol
import { walkthroughSteps } from "./steps";

export const WALKTHROUGH_KEY = "suite.walkthrough.v1";
export const WALKTHROUGH_UI_KEY = "suite.walkthrough.ui.v1";
export interface WalkthroughProgress {
  done: string[];
}
export interface WalkthroughUi {
  started: boolean;
  dismissed: boolean;
  collapsed: boolean;
}
export const initialUi: WalkthroughUi = { started: false, dismissed: false, collapsed: false };
const stepIds = new Set(walkthroughSteps.map((step) => step.id));

export function parseProgress(raw: string | null): WalkthroughProgress {
  try {
    const value = JSON.parse(raw ?? "null");
    return {
      done: Array.isArray(value?.done)
        ? [
            ...new Set<string>(
              value.done.filter((id: unknown) => typeof id === "string" && stepIds.has(id)),
            ),
          ]
        : [],
    };
  } catch {
    return { done: [] };
  }
}

export function readWalkthrough(storage: Pick<Storage, "getItem">) {
  let progress: WalkthroughProgress = { done: [] };
  let ui = initialUi;
  try {
    progress = parseProgress(storage.getItem(WALKTHROUGH_KEY));
  } catch {
    /* Memory only. */
  }
  try {
    const value = JSON.parse(storage.getItem(WALKTHROUGH_UI_KEY) ?? "null");
    ui = {
      started: value?.started === true,
      dismissed: value?.dismissed === true,
      collapsed: value?.collapsed === true,
    };
  } catch {
    /* Default visibility. */
  }
  return { progress, ui };
}

export function writeWalkthrough(
  storage: Pick<Storage, "setItem">,
  progress: WalkthroughProgress,
  ui: WalkthroughUi,
) {
  try {
    storage.setItem(WALKTHROUGH_KEY, JSON.stringify({ done: progress.done }));
  } catch {
    /* Memory only. */
  }
  try {
    storage.setItem(WALKTHROUGH_UI_KEY, JSON.stringify(ui));
  } catch {
    /* Memory only. */
  }
}
