// AUTHORED-BY Claude Opus 4.8
/**
 * Home page — rendered inside the PM app shell (AppShell in layout.tsx).
 * AppShell owns the auth gate (initialising → spinner, not-logged-in →
 * LoginScreen, logged-in → children). Page.tsx only needs to render the
 * feature content; no duplicate auth checks here.
 *
 * Suspense is required here because IssuesView uses useSearchParams() to
 * drive the active view from the URL (?view=board etc.). Next.js App Router
 * requires a Suspense boundary around any component that reads search params
 * during SSR.
 */
import { Suspense } from "react";
import { IssuesView } from "@/components/issues-view";

export default function Home() {
  return (
    <Suspense>
      <IssuesView />
    </Suspense>
  );
}
