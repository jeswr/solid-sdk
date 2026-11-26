// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect } from "react";

/** Runs outside the login gate, including when Caddy serves a static export. */
export function SuiteRedirect({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const suite = process.env.NEXT_PUBLIC_SUITE_ORIGIN;
  const redirect = Boolean(suite) && pathname === "/";
  const params =
    typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
  // An in-flight OIDC callback lands on `/` and must stay with this app.
  const callback = ["code", "state", "error", "iss"].some((key) => params.has(key));
  const go = redirect && !callback;
  useEffect(() => {
    if (!go) return;
    const tracker = new URLSearchParams(location.search).get("tracker");
    const query = tracker ? `?${new URLSearchParams({ tracker })}` : "";
    location.replace(`${suite}/tasks/issues${query}`);
  }, [go, suite]);
  return go ? null : children;
}
