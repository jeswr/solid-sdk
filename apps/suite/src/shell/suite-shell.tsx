// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  AppRail,
  type AppSlug,
  Avatar,
  AvatarFallback,
  BottomTabBar,
  Button,
  Input,
  type RailPreferences,
  RailPreferencesProvider,
} from "@jeswr/suite-ui";
import {
  defaultShellPreferences,
  parseShellPreferences,
  ShellFrame,
  type ShellFrameProps,
  type ShellPreferences,
} from "@jeswr/suite-ui/shell";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useState } from "react";
import { useSuiteEnvironment } from "./environment";
import { parseRailPreferences } from "./lib/preferences";
import { appRegistry, visibleApps } from "./registry";
import { useAccounts } from "./session/accounts-provider";
import { SessionGuard } from "./session/session-guard";

export interface SuiteShellProps {
  app: AppSlug;
  pageTitle: string;
  sidebar?: ShellFrameProps["sidebar"];
  context?: ReactNode;
  actions?: ReactNode;
  details?: ShellFrameProps["details"];
  children: ReactNode;
}

function Frame({
  app: slug,
  pageTitle,
  sidebar,
  context,
  actions,
  details,
  children,
}: SuiteShellProps) {
  const pathname = usePathname();
  const { active } = useAccounts();
  const env = useSuiteEnvironment();
  const app = appRegistry.find((item) => item.slug === slug);
  const [preferences, setPreferences] = useState<ShellPreferences>(defaultShellPreferences);
  const [rail, setRail] = useState<RailPreferences>(() => parseRailPreferences(null));
  useEffect(() => {
    try {
      setPreferences(
        parseShellPreferences(JSON.parse(localStorage.getItem("suite.shell.v1") ?? "null")),
      );
    } catch {
      /* Defaults. */
    }
    try {
      setRail(parseRailPreferences(JSON.parse(localStorage.getItem("suite.rail.v1") ?? "null")));
    } catch {
      /* Defaults. */
    }
  }, []);
  if (!app) return null;
  const updateShell = (value: ShellPreferences) => {
    setPreferences(value);
    try {
      localStorage.setItem("suite.shell.v1", JSON.stringify(value));
    } catch {
      /* Memory-only preferences. */
    }
  };
  const updateRail = (value: RailPreferences) => {
    const valid = parseRailPreferences(value);
    setRail(valid);
    try {
      localStorage.setItem("suite.rail.v1", JSON.stringify(valid));
    } catch {
      /* Memory-only preferences. */
    }
  };
  const account = active && (
    <a
      className="suite-shell-icon-button"
      href="/settings/account"
      aria-label={`Account: ${active.name}`}
    >
      <Avatar>
        <AvatarFallback>
          {active.name
            .split(/\s+/u)
            .map((part) => part[0])
            .slice(0, 2)
            .join("")}
        </AvatarFallback>
      </Avatar>
    </a>
  );
  const apps = visibleApps(env.NEXT_PUBLIC_SHOW_BACKLOG_APPS);
  return (
    <RailPreferencesProvider
      value={{ value: rail, update: updateRail, status: "ready", retry: () => {} }}
    >
      <ShellFrame
        skipLink={false}
        pageTitle={pageTitle}
        preferences={preferences}
        onPreferencesChange={updateShell}
        rail={<AppRail currentApp={slug} apps={apps} account={account} />}
        tabBar={<BottomTabBar currentApp={slug} apps={apps} />}
        sidebar={
          sidebar ?? { label: `${app.name} sections`, sections: app.sidebar?.({ pathname }) ?? [] }
        }
        {...(details ? { details } : {})}
        topBar={{
          appName: app.name,
          context,
          actions,
          account: <div className="shell-mobile-account">{account}</div>,
          search: (
            // biome-ignore lint/a11y/useSemanticElements: The lane contract requires a search form with native GET submission.
            <form role="search" action="/search" className="shell-search">
              <label className="suite-sr-only" htmlFor="shell-search">
                Search in {app.name}
              </label>
              <Input
                id="shell-search"
                name="q"
                type="search"
                placeholder={`Search in ${app.name}`}
              />
              <input type="hidden" name="scope" value={slug} />
              <Button type="submit" variant="ghost">
                Search
              </Button>
            </form>
          ),
        }}
      >
        {children}
      </ShellFrame>
    </RailPreferencesProvider>
  );
}

export function SuiteShell(props: SuiteShellProps) {
  return (
    <Suspense>
      <SessionGuard>
        <Frame {...props} />
      </SessionGuard>
    </Suspense>
  );
}
