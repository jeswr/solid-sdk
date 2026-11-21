// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect } from "react";

/** Runs outside the login gate, including when Caddy serves a static export. */
export function SuiteRedirect({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const suite = process.env.NEXT_PUBLIC_SUITE_ORIGIN;
  const redirect = Boolean(suite) && pathname === "/";
  useEffect(() => {
    if (redirect) location.replace(`${suite}/tasks/issues${location.search}`);
  }, [redirect, suite]);
  return redirect ? null : children;
}
