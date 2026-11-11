// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
"use client";
import { ThemeProvider, useTheme } from "next-themes";
import { Suspense, useEffect } from "react";
import { NativePreviewCleanup } from "@/components/native-preview-cleanup";
import { NativeShareLaunch } from "@/components/native-share-launch";
import { accountFixtureProps } from "@/shell/account/test-backends";
import { SuiteEnvironmentContext } from "@/shell/environment";
import type { SuiteEnv } from "@/shell/lib/env";
import { NotificationsProvider } from "@/shell/notifications/provider";
import { ShellSearchProvider } from "@/shell/search/search-context";
import { AccountsProvider } from "@/shell/session/accounts-provider";
import { AppearanceEffect, PreferencesProvider } from "@/shell/settings/preferences";
import { OutboxSessionProvider } from "@/shell/sync/outbox-session";
import { ServiceWorkerRegistration } from "@/shell/sync/service-worker";
import { WalkthroughProvider } from "@/welcome/walkthrough-provider";

function ThemeAttribute() {
  const { theme } = useTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = theme ?? "system";
  }, [theme]);
  return null;
}
export function Providers({
  children,
  environment,
}: {
  children: React.ReactNode;
  environment: SuiteEnv;
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem enableColorScheme>
      <ThemeAttribute />
      <ServiceWorkerRegistration />
      <SuiteEnvironmentContext.Provider value={environment}>
        <AccountsProvider {...accountFixtureProps()}>
          <Suspense>
            <NativeShareLaunch />
          </Suspense>
          {process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? <NativePreviewCleanup /> : null}
          <OutboxSessionProvider>
            <PreferencesProvider>
              <AppearanceEffect />
              <ShellSearchProvider>
                <NotificationsProvider>
                  <WalkthroughProvider>{children}</WalkthroughProvider>
                </NotificationsProvider>
              </ShellSearchProvider>
            </PreferencesProvider>
          </OutboxSessionProvider>
        </AccountsProvider>
      </SuiteEnvironmentContext.Provider>
    </ThemeProvider>
  );
}
