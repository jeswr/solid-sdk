// AUTHORED-BY Claude Opus 5.5
// What the automation views share: the simulated apps, the automations, and the pop-up.
import { createContext, useContext } from "react";
import type { AppsSession, Automation } from "./automations.js";

export interface AutomationsApi {
  readonly apps: AppsSession;
  /** Automations the visitor has kept (on or off). */
  readonly automations: readonly Automation[];
  /** Find a kept automation or a draft by rule id. */
  find(id: string): Automation | undefined;
  /** Remember a draft (not yet kept). */
  addDraft(automation: Automation): void;
  /** Open the rule pop-up. */
  showSheet(id: string): void;
  setOn(id: string, on: boolean): void;
}

export const AutomationsContext = createContext<AutomationsApi | null>(null);

export function useAutomations(): AutomationsApi {
  const api = useContext(AutomationsContext);
  if (!api) throw new Error("No automations context");
  return api;
}
