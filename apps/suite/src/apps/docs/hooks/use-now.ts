// AUTHORED-BY Codex
"use client";
import { useEffect, useState } from "react";

/** The first render is identical on the server and client; clocks start after mount. */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
