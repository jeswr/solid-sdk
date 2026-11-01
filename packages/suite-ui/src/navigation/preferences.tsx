// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { AppSlug } from "./apps.js";

export type NavigationError =
  | "reauth"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "name-taken"
  | "quota"
  | "too-large"
  | "offline"
  | "unreachable"
  | "unsupported"
  | "unknown";
export interface RailPreferences {
  pinned: readonly AppSlug[];
}
/** UI adapter for SDK-APP-11's per-account usePreferences('rail') result. */
export interface RailPreferencesBinding {
  value: RailPreferences;
  update: (value: RailPreferences) => void;
  status: "ready" | "loading" | "refreshing" | "saving";
  error?: NavigationError;
  retry: () => void;
}
const PreferencesContext = createContext<RailPreferencesBinding | null>(null);
export function RailPreferencesProvider({
  value,
  children,
}: {
  value: RailPreferencesBinding;
  children: ReactNode;
}) {
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
export function usePreferences(_key: "rail"): RailPreferencesBinding {
  const preferences = useContext(PreferencesContext);
  if (!preferences)
    throw new Error(
      "Wrap suite navigation in RailPreferencesProvider with the account's rail preferences.",
    );
  return preferences;
}
