// AUTHORED-BY Claude Fable 5
"use client";

import { AppShell, ConsentInterstitial, ShowcaseTrustProvider } from "@jeswr/solid-showcase-kit";
import type { ReactNode } from "react";
import { Launcher } from "../components/launcher.js";
import { documentDisclaimerPack, shellApp, shellTheme } from "../document.js";
import type { WalkthroughDocument } from "../schema.js";

export interface ShowcaseLayoutProps {
  document: WalkthroughDocument;
  children: ReactNode;
}

/**
 * The walkthrough shell frame, entirely document-driven: trust provider + AppShell
 * (variant "own" — the shell publishes under the convener's own branding), section nav,
 * the launcher dock, and the per-app consent interstitial. Render it inside your root
 * layout's `<body>`.
 */
export function ShowcaseLayout({ document: doc, children }: ShowcaseLayoutProps) {
  const pack = documentDisclaimerPack(doc);
  const theme = shellTheme(doc);
  const shell = shellApp(doc.registry);

  return (
    <ShowcaseTrustProvider pack={pack} theme={theme}>
      <AppShell
        appName={doc.site.appName}
        headerActions={
          <nav aria-label="Walkthrough sections" className="flex items-center gap-4 text-sm">
            <a className="text-muted-foreground hover:text-foreground" href="/#ecosystem">
              Ecosystem
            </a>
            <a className="text-muted-foreground hover:text-foreground" href="/#chapters">
              Chapters
            </a>
            {doc.compliance !== undefined && (
              <a className="text-muted-foreground hover:text-foreground" href="/compliance">
                {doc.compliance.title}
              </a>
            )}
          </nav>
        }
        variant="own"
      >
        {children}
      </AppShell>
      <Launcher registry={doc.registry} />
      <ConsentInterstitial
        appId={shell?.slug ?? doc.deploy.slug}
        organization={doc.site.organization}
        variant="own"
      />
    </ShowcaseTrustProvider>
  );
}
