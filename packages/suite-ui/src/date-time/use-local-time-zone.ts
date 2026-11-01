// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { useEffect, useState } from "react";

/** Keep SSR and initial hydration deterministic; localize only after mount. */
export function useLocalTimeZone(): string | undefined {
  const [timeZone, setTimeZone] = useState<string>();
  useEffect(() => {
    setTimeZone(new Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  return timeZone;
}
