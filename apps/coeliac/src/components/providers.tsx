// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The client provider stack: `@jeswr/app-shell` `ThemeProvider` (light/dark) over
 * the `SessionProvider` (auth seam + silent restore). Everything below is a client
 * boundary so the reactive-auth wiring never runs during server prerender.
 */
import { ThemeProvider } from "@jeswr/app-shell";
import type { ReactNode } from "react";
import { SessionProvider } from "./auth/session-provider";
import { ServiceWorkerRegistrar } from "./service-worker-registrar";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system" storageKey="coeliac-diary:theme">
      {/* App-shell offline layer — registers outside the auth boundary so the
          public shell is cached even before sign-in (UX invariant #3). */}
      <ServiceWorkerRegistrar />
      <SessionProvider>{children}</SessionProvider>
    </ThemeProvider>
  );
}
