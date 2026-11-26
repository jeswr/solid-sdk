// AUTHORED-BY Claude Opus 5.5
"use client";
import { dir, negotiateLocale, readDeviceLocale } from "@jeswr/suite-i18n";
import { I18nProvider, useT } from "@jeswr/suite-i18n/react";
import { type ReactNode, useSyncExternalStore } from "react";
import { missingPlatformFeatures, type StartupScope } from "@/lib/native/startup-check";

const noSubscription = () => () => {};
let checked: string | undefined;
// One answer per page load; the platform's features do not change while it runs.
const clientSnapshot = () => {
  checked ??= missingPlatformFeatures(globalThis as StartupScope).join(" ");
  return checked;
};
const serverSnapshot = () => null;

/**
 * Renders the app only once the startup check passes (MOB-P3 E6), so no provider, session restore
 * or pod-auth runs before it. Modules below the gate still load with the page, so they must not
 * touch the platform at import time.
 */
export function NativeStartupGate({ children }: { children: ReactNode }) {
  const missing = useSyncExternalStore(noSubscription, clientSnapshot, serverSnapshot);
  if (missing === null) return null;
  if (missing === "") return children;
  // No preference provider runs yet: use the device's language choice, then the browser's.
  const locale = negotiateLocale(readDeviceLocale(), globalThis.navigator?.languages ?? []);
  return (
    <I18nProvider locale={locale}>
      <UpdateNeeded missing={missing} locale={locale} />
    </I18nProvider>
  );
}

function UpdateNeeded({ missing, locale }: { missing: string; locale: string }) {
  const t = useT();
  return (
    <main
      id="main-content"
      className="native-update"
      data-missing={missing}
      lang={locale}
      dir={dir(locale)}
    >
      <h1>{t("startup.title")}</h1>
      <p>{t("startup.body")}</p>
    </main>
  );
}
