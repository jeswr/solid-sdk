// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { CapabilityProvider } from "@jeswr/suite-ui/sync";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useSuiteEnvironment } from "../environment";
import { demoCapabilitiesWith } from "../lib/settings-capabilities";
import { useAccounts } from "../session/accounts-provider";
import { SuiteShell } from "../suite-shell";
import { AutosaveStatus } from "./preferences";

const sections = [
  ["account", "Account"],
  ["appearance", "Appearance"],
  ["storage", "Storage"],
  ["notifications", "Notifications"],
  ["offline", "Offline"],
  ["shortcuts", "Shortcuts"],
  ["advanced", "Advanced"],
] as const;

export function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { active } = useAccounts();
  const env = useSuiteEnvironment();
  const page = sections.find(([slug]) => pathname === `/settings/${slug}`)?.[1] ?? "Account";
  return (
    <CapabilityProvider
      capabilities={active?.kind === "demo" ? demoCapabilitiesWith(env.SUITE_TEST_CAPS) : {}}
    >
      <SuiteShell
        app="home"
        pageTitle={page}
        sidebar={{
          label: "Settings sections",
          header: <h2>Settings</h2>,
          sections: [
            {
              id: "settings",
              label: "Settings",
              items: sections.map(([slug, label]) => ({
                id: slug,
                label,
                href: `/settings/${slug}`,
                current: pathname === `/settings/${slug}`,
              })),
            },
          ],
        }}
      >
        <div className="settings-content">
          {children}
          <AutosaveStatus />
        </div>
      </SuiteShell>
    </CapabilityProvider>
  );
}
