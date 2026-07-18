"use client";

import {
  AppShell,
  ConsentInterstitial,
  createDisclaimerPack,
  ShowcaseTrustProvider,
  themeFromSpec,
} from "@jeswr/solid-showcase-kit";
import type { ReactNode } from "react";
import { app, walkthrough } from "../lib/walkthrough";

/**
 * The non-removable trust frame: disclaimer pack + org theme from the registry,
 * AppShell (variant "modelled" — this surface is modelled ON an organisation,
 * never published BY it), and the per-app consent interstitial.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const pack = createDisclaimerPack(walkthrough.branding);
  const theme = app.theme === undefined ? undefined : themeFromSpec(app.theme, app.modelledOn);
  return (
    <ShowcaseTrustProvider pack={pack} theme={theme}>
      <AppShell appName={app.appName} variant="modelled">
        {children}
      </AppShell>
      <ConsentInterstitial
        appId={app.slug}
        learnMoreHref="/"
        organization={app.modelledOn}
        variant="modelled"
      />
    </ShowcaseTrustProvider>
  );
}
