// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import { ThemeProvider, useTheme } from "next-themes";
import { useEffect } from "react";
import { NativePreviewCleanup } from "@/components/native-preview-cleanup";
import { accountFixtureProps } from "@/shell/account/test-backends";
import { SuiteEnvironmentContext } from "@/shell/environment";
import type { SuiteEnv } from "@/shell/lib/env";
import { NotificationsProvider } from "@/shell/notifications/provider";
import { ShellSearchProvider } from "@/shell/search/search-context";
import { AccountsProvider } from "@/shell/session/accounts-provider";
import { AppearanceEffect, PreferencesProvider } from "@/shell/settings/preferences";
import { ServiceWorkerRegistration } from "@/shell/sync/service-worker";

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
          {process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? <NativePreviewCleanup /> : null}
          <PreferencesProvider>
            <AppearanceEffect />
            <ShellSearchProvider>
              <NotificationsProvider>{children}</NotificationsProvider>
            </ShellSearchProvider>
          </PreferencesProvider>
        </AccountsProvider>
      </SuiteEnvironmentContext.Provider>
    </ThemeProvider>
  );
}
