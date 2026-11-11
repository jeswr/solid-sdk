// AUTHORED-BY Claude Opus 5.5
"use client";
import { useEffect } from "react";
/** Marks the fixture page as hydrated so e2e shots never act on server-rendered markup. */
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.fixturesHydrated = "true";
    return () => {
      delete document.documentElement.dataset.fixturesHydrated;
    };
  }, []);
  return null;
}
