"use client";
// Client boundary that mounts the suite shell + Solid auth runtime.
//
// - <ThemeProvider> (@jeswr/app-shell) is the suite's framework-agnostic
//   light/dark/system theme system. It is SSR-SAFE (no browser-only globals at
//   import or first render), so it wraps everything directly — paired with the
//   no-flash `themeScript()` injected in app/layout.tsx <head>.
// - <SolidAuthProvider> renders a browser-only custom element and patches the
//   global fetch, so it must never run on the server: we load it with
//   `next/dynamic` + `ssr: false`. It sits INSIDE the theme provider so the
//   whole app (including the auth UI) is themed.
import { ThemeProvider } from "@jeswr/app-shell";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";

const SolidAuthProvider = dynamic(
  () => import("@/components/solid/SolidAuthProvider").then((m) => m.SolidAuthProvider),
  { ssr: false },
);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <SolidAuthProvider>{children}</SolidAuthProvider>
    </ThemeProvider>
  );
}
