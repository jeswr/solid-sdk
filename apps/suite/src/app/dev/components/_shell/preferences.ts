// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  defaultShellPreferences,
  parseShellPreferences,
  type ShellPreferences,
} from "@jeswr/suite-ui/shell";
import { useEffect, useState } from "react";

// Dev fixture adapter only. Production consumers provide the SDK preferences hook.
const key = "solid-suite:dev-fixtures:shell";
export function useFixturePreferences() {
  const [preferences, setPreferences] = useState(defaultShellPreferences);
  useEffect(() => {
    const read = () => {
      try {
        setPreferences(parseShellPreferences(JSON.parse(localStorage.getItem(key) ?? "null")));
      } catch {
        setPreferences(defaultShellPreferences);
      }
    };
    read();
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) read();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return [
    preferences,
    (value: ShellPreferences) => {
      setPreferences(value);
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* In-memory preferences still work when storage is unavailable. */
      }
    },
  ] as const;
}
