// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  AppRail,
  type AppSlug,
  BottomTabBar,
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
import { OfflinePill } from "@jeswr/suite-ui/sync";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useState } from "react";
import { AccountMenu } from "./account/account-menu";
import { useSuiteEnvironment } from "./environment";
import { parseRailPreferences } from "./lib/preferences";
import type { SearchSource } from "./lib/search-results";
import { NotificationsBell } from "./notifications/notifications-bell";
import { appRegistry, visibleApps } from "./registry";
import { GlobalSearch } from "./search/global-search";
import { useShellSearchSource } from "./search/search-context";
import { useAccounts } from "./session/accounts-provider";
import { SessionGuard } from "./session/session-guard";
import { GlobalShortcuts } from "./shortcuts/global-shortcuts";
import { ShortcutsProvider, useShortcutSettings } from "./shortcuts/provider";
import { useSyncSnapshot } from "./sync/online";
import { ShellSyncSheet } from "./sync/shell-sync-sheet";

export interface SuiteShellProps {
  app: AppSlug;
  pageTitle: string;
  sidebar?: ShellFrameProps["sidebar"];
  context?: ReactNode;
  actions?: ReactNode;
  details?: ShellFrameProps["details"];
  /** Overrides the account's shared search source (ShellSearchProvider) for this page. */
  searchSource?: SearchSource;
  children: ReactNode;
}

function Frame({
  app: slug,
  pageTitle,
  sidebar,
  context,
  actions,
  details,
  searchSource,
  children,
}: SuiteShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const shellSource = useShellSearchSource();
  const sync = useSyncSnapshot();
  const [syncOpen, setSyncOpen] = useState(false);
  const { active } = useAccounts();
  const { characterKeys } = useShortcutSettings();
  const env = useSuiteEnvironment();
  const app = appRegistry.find((item) => item.slug === slug);
  useEffect(() => {
    if (app) document.title = `${pageTitle} · ${app.name} · Solid Suite`;
  }, [app, pageTitle]);
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
  const account = active && <AccountMenu />;
  const apps = visibleApps(env.NEXT_PUBLIC_SHOW_BACKLOG_APPS);
  return (
    <RailPreferencesProvider
      value={{ value: rail, update: updateRail, status: "ready", retry: () => {} }}
    >
      <ShellFrame
        skipLink={false}
        characterShortcuts={characterKeys}
        pageTitle={pageTitle}
        preferences={preferences}
        onPreferencesChange={updateShell}
        rail={
          <AppRail
            currentApp={slug}
            apps={apps}
            account={account}
            notifications={<NotificationsBell onOpenSync={() => setSyncOpen(true)} />}
          />
        }
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
          bell: <NotificationsBell mobile />,
          offlinePill: <OfflinePill snapshot={sync} onOpen={() => setSyncOpen(true)} />,
          search: (
            <GlobalSearch
              source={searchSource ?? shellSource}
              scope={{ app: slug, label: app.name }}
              onOpen={(result) => router.push(result.href)}
              onSeeAll={(query, scope) =>
                router.push(
                  `/search?q=${encodeURIComponent(query)}${scope ? `&scope=${scope}` : ""}`,
                )
              }
            />
          ),
        }}
      >
        {children}
      </ShellFrame>
      <ShellSyncSheet open={syncOpen} onOpenChange={setSyncOpen} />
    </RailPreferencesProvider>
  );
}

/**
 * Global shortcuts (and the palette and help sheet they open) exist only while the
 * session is usable: an expired session's re-auth dialog must stay the only layer.
 */
function ReadyShortcuts() {
  const { status } = useAccounts();
  return status === "ready" ? <GlobalShortcuts /> : null;
}

export function SuiteShell(props: SuiteShellProps) {
  return (
    <Suspense>
      <SessionGuard>
        <ShortcutsProvider>
          <ReadyShortcuts />
          <Frame {...props} />
        </ShortcutsProvider>
      </SessionGuard>
    </Suspense>
  );
}
