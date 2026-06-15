// AUTHORED-BY Claude Opus 4.8
/**
 * Home page — rendered inside the PM app shell (AppShell in layout.tsx).
 * AppShell owns the auth gate (initialising → spinner, not-logged-in →
 * LoginScreen, logged-in → children). Page.tsx only needs to render the
 * feature content; no duplicate auth checks here.
 */
import { IssuesView } from "@/components/issues-view";

export default function Home() {
  return <IssuesView />;
}
