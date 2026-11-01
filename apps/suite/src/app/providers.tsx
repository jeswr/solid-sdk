// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { ThemeProvider, useTheme } from "next-themes";
import { useEffect } from "react";
import { SuiteEnvironmentContext } from "@/shell/environment";
import type { SuiteEnv } from "@/shell/lib/env";
import { AccountsProvider } from "@/shell/session/accounts-provider";

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
      <SuiteEnvironmentContext.Provider value={environment}>
        <AccountsProvider>{children}</AccountsProvider>
      </SuiteEnvironmentContext.Provider>
    </ThemeProvider>
  );
}
