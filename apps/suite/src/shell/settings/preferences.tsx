// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { Toaster } from "@jeswr/suite-ui";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  defaultPreferences,
  mergePreferences,
  type Preferences,
  parsePreferences,
  preferencesKey,
} from "../lib/settings-preferences";
import { useAccounts } from "../session/accounts-provider";
import "./settings.css";

type SaveStatus = "" | "Saved" | "Changes are saved for this visit only";
interface Binding {
  preferences: Preferences;
  update: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  status: SaveStatus;
  ready: boolean;
}
const Context = createContext<Binding | null>(null);

function read(accountId: string): Preferences {
  try {
    return parsePreferences(localStorage.getItem(preferencesKey(accountId)));
  } catch {
    return parsePreferences(null);
  }
}

/** A tagged snapshot prevents a previous account's settings painting during a switch. */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { active } = useAccounts();
  const accountId = active?.id ?? "";
  const [snapshot, setSnapshot] = useState({
    accountId: "",
    preferences: defaultPreferences,
    ready: false,
    status: "" as SaveStatus,
  });
  const latest = useRef(snapshot);
  useLayoutEffect(() => {
    const load = () => {
      const next = {
        accountId,
        preferences: read(accountId),
        ready: Boolean(accountId),
        status: "" as SaveStatus,
      };
      latest.current = next;
      setSnapshot(next);
    };
    load();
    const storage = (event: StorageEvent) => {
      if (event.key === preferencesKey(accountId) || event.key === null) load();
    };
    addEventListener("storage", storage);
    return () => removeEventListener("storage", storage);
  }, [accountId]);
  const current = snapshot.accountId === accountId ? snapshot.preferences : defaultPreferences;
  const update: Binding["update"] = (key, value) => {
    if (!accountId) return;
    const previous =
      latest.current.accountId === accountId ? latest.current.preferences : read(accountId);
    const preferences = mergePreferences(previous, { [key]: value });
    let status: SaveStatus = "Saved";
    try {
      localStorage.setItem(preferencesKey(accountId), JSON.stringify(preferences));
    } catch {
      status = "Changes are saved for this visit only";
    }
    const next = { accountId, preferences, ready: true, status };
    latest.current = next;
    setSnapshot(next);
  };
  return (
    <Context.Provider
      value={{
        preferences: current,
        update,
        status: snapshot.accountId === accountId ? snapshot.status : "",
        ready: snapshot.accountId === accountId && snapshot.ready,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function usePreferences<K extends keyof Preferences>(key: K) {
  const context = useContext(Context);
  if (!context) throw new Error("usePreferences requires PreferencesProvider");
  return {
    value: context.preferences[key],
    update: (value: Preferences[K]) => context.update(key, value),
    status: context.status,
  };
}

export function useAllPreferences() {
  const context = useContext(Context);
  if (!context) throw new Error("useAllPreferences requires PreferencesProvider");
  return context;
}

export function AutosaveStatus() {
  const { status } = useAllPreferences();
  return (
    <p className="settings-save-status" role="status">
      {status}
    </p>
  );
}

/** Apply per-account appearance before paint once the account's preferences are loaded. */
const OWN_TOASTER = [
  "/drive",
  "/dev",
  "/docs",
  "/tasks",
  "/contacts",
  "/money",
  "/music",
  "/photos",
  "/health",
  "/mail",
  "/chat",
  "/home",
  "/permissions",
  "/connect",
];

/** True where the page mounts its own toast region, so the shell must not add a second. */
export function ownsToaster(pathname: string): boolean {
  return OWN_TOASTER.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function AppearanceEffect() {
  const pathname = usePathname();
  const { preferences, ready } = useAllPreferences();
  const { setTheme } = useTheme();
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.dataset.density = preferences.density;
    html.dataset.fontScale = preferences.fontScale;
    html.dataset.motion = preferences.motion;
    html.dataset.appColours = String(preferences.appColours);
  }, [preferences.density, preferences.fontScale, preferences.motion, preferences.appColours]);
  useLayoutEffect(() => {
    if (ready) setTheme(preferences.theme);
  }, [preferences.theme, ready, setTheme]);
  // These apps and the dev fixtures mount their own toast region; a second one would
  // render every toast twice.
  return ownsToaster(pathname) ? null : <Toaster />;
}
