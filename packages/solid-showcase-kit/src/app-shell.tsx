// AUTHORED-BY Claude Fable 5
"use client";

import { cn } from "@jeswr/app-shell";
import type { ReactNode } from "react";
import { ConceptDemoBanner } from "./concept-demo-banner.js";
import type { DisclaimerPack, DisclaimerVariant } from "./disclaimers.js";
import { type OrgTheme, themeCssProperties } from "./themes.js";
import { useDisclaimerPack, useShowcaseTrust } from "./trust-context.js";

export interface AppShellProps {
  appName: string;
  /**
   * Org theme supplying `modelledOn`, `role`, and the palette tokens; defaults to the
   * nearest `ShowcaseTrustProvider`'s theme.
   */
  theme?: OrgTheme | undefined;
  /** "own" only for surfaces published under the convener's own branding. */
  variant?: DisclaimerVariant | undefined;
  /** Destination of the banner's "About this demo" link; defaults to the pack's. */
  aboutHref?: string | undefined;
  /** Optional right-hand header slot (nav, account menu, …). */
  headerActions?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
  /** Explicit pack; defaults to the nearest `ShowcaseTrustProvider`. */
  pack?: DisclaimerPack | undefined;
}

/**
 * Shared app frame: brand header with role-first framing, the concept-demo banner
 * rendered directly below the header (four-Ps adjacency — the banner is not a removable
 * slot), and the footer legal line. Applies the org theme's CSS custom properties to the
 * whole frame.
 */
export function AppShell({
  appName,
  theme,
  variant = "modelled",
  aboutHref,
  headerActions,
  children,
  className,
  pack,
}: AppShellProps) {
  const resolvedPack = useDisclaimerPack(pack);
  const trust = useShowcaseTrust();
  const resolvedTheme = theme ?? trust?.theme;
  if (resolvedTheme === undefined) {
    throw new Error(
      "AppShell needs an OrgTheme: pass the `theme` prop or provide one via <ShowcaseTrustProvider theme={…}>.",
    );
  }
  const framing =
    variant === "own"
      ? `${resolvedTheme.role} · ${resolvedTheme.modelledOn}`
      : `${resolvedTheme.role} · modelled on ${resolvedTheme.modelledOn}`;
  return (
    <div
      className={cn("flex min-h-dvh flex-col bg-background text-foreground", className)}
      data-app-shell=""
      style={themeCssProperties(resolvedTheme)}
    >
      <a
        className="sr-only z-50 rounded bg-card px-4 py-2 text-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
        href="#main-content"
      >
        Skip to main content
      </a>
      <header className="border-border border-b bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="font-semibold text-foreground text-lg">{appName}</p>
            <p className="text-muted-foreground text-sm">{framing}</p>
          </div>
          {headerActions}
        </div>
      </header>
      <ConceptDemoBanner
        aboutHref={aboutHref}
        organization={resolvedTheme.modelledOn}
        orgRole={resolvedTheme.role}
        pack={resolvedPack}
        placement="static"
        variant={variant}
      />
      {/* The skip link's target lives HERE so every consumer gets a working
          "Skip to main content" without declaring its own #main-content. */}
      <div className="flex-1" id="main-content" tabIndex={-1}>
        {children}
      </div>
      <footer className="border-border border-t bg-card" data-demo-footer="">
        <p className="mx-auto w-full max-w-5xl px-6 py-4 text-muted-foreground text-xs">
          {resolvedPack.footerLegalLine({ organization: resolvedTheme.modelledOn, variant })}
        </p>
      </footer>
    </div>
  );
}
