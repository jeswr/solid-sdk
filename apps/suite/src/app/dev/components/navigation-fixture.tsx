// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import {
  AppLauncher,
  AppRail,
  BottomTabBar,
  defaultRailPins,
  type NavigationApp,
  type NavigationError,
  type RailPreferences,
  RailPreferencesProvider,
  suiteApps,
} from "@jeswr/suite-ui";
import { Bell, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

const errors: readonly NavigationError[] = [
  "reauth",
  "forbidden",
  "not-found",
  "conflict",
  "name-taken",
  "quota",
  "too-large",
  "offline",
  "unreachable",
  "unsupported",
  "unknown",
];
export function NavigationFixture({
  component,
}: {
  component: "AppRail" | "AppLauncher" | "BottomTabBar";
}) {
  const [state, setState] = useState("ready");
  const [value, setValue] = useState<RailPreferences>({ pinned: defaultRailPins });
  const [message, setMessage] = useState("");
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("suite-dev-fixture-rail") ?? "null");
      if (Array.isArray(saved) && saved.every((slug) => suiteApps.some((app) => app.slug === slug)))
        setValue({ pinned: [...new Set(saved)].slice(0, 6) });
    } catch {
      /* The fixture remains usable when browser storage is unavailable. */
    }
  }, []);
  const apps: NavigationApp[] = (state === "unavailable" ? [] : suiteApps).map((app) => ({
    ...app,
    create:
      app.slug === "docs"
        ? [
            {
              id: "document",
              label: "New document",
              onSelect: () => setMessage("Create a document selected"),
            },
          ]
        : app.slug === "tasks"
          ? [
              {
                id: "task",
                label: "New task",
                onSelect: () => setMessage("Create a task selected"),
              },
            ]
          : app.slug === "drive"
            ? [
                {
                  id: "upload",
                  label: "Upload file",
                  onSelect: () => setMessage("Upload a file selected"),
                },
                {
                  id: "folder",
                  label: "New folder",
                  onSelect: () => setMessage("Create a folder selected"),
                },
              ]
            : [],
  }));
  const binding = {
    value: state === "empty" ? { pinned: [] } : value,
    update: (next: RailPreferences) => {
      setValue(next);
      setState("ready");
      try {
        localStorage.setItem("suite-dev-fixture-rail", JSON.stringify(next.pinned));
      } catch {
        setMessage("Preferences are available for this visit only");
      }
    },
    status:
      state === "loading"
        ? ("loading" as const)
        : state === "refreshing"
          ? ("refreshing" as const)
          : state === "saving"
            ? ("saving" as const)
            : ("ready" as const),
    ...(errors.includes(state as NavigationError) ? { error: state as NavigationError } : {}),
    retry: () => {
      setState("ready");
      setMessage("App preferences reloaded");
    },
  };
  const launcher = <AppLauncher currentApp="drive" apps={apps} />;
  return (
    <RailPreferencesProvider value={binding}>
      <div
        className={
          component === "AppRail"
            ? "navigation-fixture navigation-fixture-rail"
            : "navigation-fixture"
        }
      >
        {component === "AppRail" && (
          <AppRail
            currentApp="drive"
            apps={apps}
            notifications={
              <button
                type="button"
                className="suite-rail-button"
                aria-label="Notifications, 2 unread"
                title="Notifications, 2 unread"
                onClick={() => setMessage("Notifications selected")}
              >
                <Bell size={20} strokeWidth={1.75} aria-hidden="true" />
                <span className="fixture-unread" aria-hidden="true">
                  2
                </span>
              </button>
            }
            offline={
              state === "cached" || state === "offline" ? (
                <button
                  type="button"
                  className="suite-rail-button"
                  aria-label="Offline — showing saved copies"
                  title="Offline — showing saved copies"
                  onClick={() => setMessage("Sync status selected")}
                >
                  <WifiOff size={20} strokeWidth={1.75} aria-hidden="true" />
                </button>
              ) : null
            }
            account={
              <button
                type="button"
                className="suite-rail-button"
                aria-label="Account menu, Alice Wilder"
                title="Account menu, Alice Wilder"
                onClick={() => setMessage("Account menu selected")}
              >
                <span className="fixture-avatar" aria-hidden="true">
                  AW
                </span>
              </button>
            }
          />
        )}
        <main id="main-content" tabIndex={-1} className="fixture-page navigation-fixture-content">
          <div className="fixture-heading">
            <p className="eyebrow">Solid Suite · DS-03</p>
            <h1>{component}</h1>
            <p>App navigation, launcher and rail preferences.</p>
            <a href="/dev/components">All component fixtures</a>
          </div>
          <label className="fixture-state">
            Fixture state
            <select value={state} onChange={(event) => setState(event.target.value)}>
              {[
                "ready",
                "loading",
                "refreshing",
                "saving",
                "empty",
                "cached",
                "unavailable",
                ...errors,
              ].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          {state === "cached" && <p role="status">Offline — showing saved copies</p>}
          {component === "AppLauncher" && <div>{launcher}</div>}
          {component === "AppRail" && (
            <p>The 56px app rail appears from 768px. On small screens, use More below.</p>
          )}
          {component !== "AppLauncher" && <BottomTabBar currentApp="drive" apps={apps} />}
          {component === "BottomTabBar" && <p>The five-slot app bar appears below 768px.</p>}
          {component === "BottomTabBar" && (
            <div className="fixture-desktop-launcher">{launcher}</div>
          )}
          <p role="status" className="fixture-feedback">
            {message}
          </p>
        </main>
      </div>
    </RailPreferencesProvider>
  );
}
