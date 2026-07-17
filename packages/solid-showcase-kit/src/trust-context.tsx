// AUTHORED-BY Claude Fable 5
"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { DisclaimerPack } from "./disclaimers.js";
import type { OrgTheme } from "./themes.js";

export interface ShowcaseTrustValue {
  pack: DisclaimerPack;
  theme?: OrgTheme | undefined;
}

const ShowcaseTrustContext = createContext<ShowcaseTrustValue | null>(null);

export interface ShowcaseTrustProviderProps {
  /** The pack from `createDisclaimerPack(branding)`. */
  pack: DisclaimerPack;
  /** Optional org theme consumed by `AppShell` when no `theme` prop is passed. */
  theme?: OrgTheme | undefined;
  children: ReactNode;
}

/**
 * Provides the disclaimer pack (and optionally the org theme) to every trust component
 * below it. Wrap each app's root layout once:
 *
 * ```tsx
 * <ShowcaseTrustProvider pack={pack} theme={theme}>{children}</ShowcaseTrustProvider>
 * ```
 */
export function ShowcaseTrustProvider({ pack, theme, children }: ShowcaseTrustProviderProps) {
  const value = useMemo(() => ({ pack, theme }), [pack, theme]);
  return <ShowcaseTrustContext.Provider value={value}>{children}</ShowcaseTrustContext.Provider>;
}

/** The current trust context, or `null` outside a provider. */
export function useShowcaseTrust(): ShowcaseTrustValue | null {
  return useContext(ShowcaseTrustContext);
}

/**
 * Resolve the disclaimer pack for a trust component: an explicit `pack` prop wins, then
 * the nearest {@link ShowcaseTrustProvider}. Fail-closed: with neither, this THROWS —
 * a trust surface must never render without its required copy.
 */
export function useDisclaimerPack(explicit?: DisclaimerPack | undefined): DisclaimerPack {
  const context = useContext(ShowcaseTrustContext);
  const pack = explicit ?? context?.pack;
  if (pack === undefined) {
    throw new Error(
      "No DisclaimerPack available: pass the `pack` prop or wrap the tree in <ShowcaseTrustProvider pack={createDisclaimerPack(branding)}>.",
    );
  }
  return pack;
}
