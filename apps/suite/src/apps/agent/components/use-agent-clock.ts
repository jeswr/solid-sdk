// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useEffect, useState } from "react";

/** Also tick exactly at policy boundaries, even when they fall between regular ticks. */
export function useAgentClock(boundaries: readonly number[] = []) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const next = Math.min(...boundaries.filter((at) => at > now));
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(2147483647, Math.max(0, next - Math.max(now, Date.now()))),
    );
    return () => clearTimeout(timer);
  }, [next, now]);
  return now;
}
