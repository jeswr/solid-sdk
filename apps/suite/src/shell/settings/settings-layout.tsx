// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import { useT } from "@jeswr/suite-i18n/react";
import { CapabilityProvider } from "@jeswr/suite-ui/sync";
import type { ReactNode } from "react";
import { useRoutePathname } from "@/lib/route-params";
import { useSuiteEnvironment } from "../environment";
import { demoCapabilitiesWith } from "../lib/settings-capabilities";
import { useAccounts } from "../session/accounts-provider";
import { SuiteShell } from "../suite-shell";
import { AutosaveStatus } from "./preferences";

const sections = [
  ["account", "settings.account"],
  ["appearance", "settings.appearance"],
  ["storage", "settings.storage"],
  ["notifications", "settings.notifications"],
  ["offline", "settings.offline"],
  ["shortcuts", "settings.shortcuts"],
  ["advanced", "settings.advanced"],
] as const;

export function SettingsLayout({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = useRoutePathname();
  const { active } = useAccounts();
  const env = useSuiteEnvironment();
  const page =
    sections.find(([slug]) => pathname === `/settings/${slug}`)?.[1] ?? "settings.account";
  return (
    <CapabilityProvider
      capabilities={active?.kind === "demo" ? demoCapabilitiesWith(env.SUITE_TEST_CAPS) : {}}
    >
      <SuiteShell
        app="home"
        pageTitle={t(page)}
        sidebar={{
          label: t("settings.sections"),
          header: <h2>{t("settings.title")}</h2>,
          sections: [
            {
              id: "settings",
              label: t("settings.title"),
              items: sections.map(([slug, label]) => ({
                id: slug,
                label: t(label),
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
