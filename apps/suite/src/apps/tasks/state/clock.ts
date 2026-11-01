// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useEffect, useState } from "react";

/** The next minute or local midnight, whichever comes first (including DST changes). */
export function nextBoundary(now: Date): Date {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const minute = Math.floor(now.getTime() / 60_000) * 60_000 + 60_000;
  return new Date(Math.min(midnight.getTime(), minute));
}

export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const current = new Date();
      setNow(current);
      timer = setTimeout(update, nextBoundary(current).getTime() - current.getTime());
    };
    const visible = () => {
      if (document.visibilityState === "visible") update();
    };
    update();
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return now;
}
