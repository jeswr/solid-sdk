// AUTHORED-BY Codex
"use client";
import { useEffect, useState } from "react";

const KEY = "suite.docs.starred";
/** Local adapter until account preferences are available. */
export function useStarred() {
  const [starred, setStarred] = useState<readonly string[]>([]);
  useEffect(() => {
    const read = () => {
      try {
        const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
        setStarred(
          Array.isArray(value) ? value.filter((url): url is string => typeof url === "string") : [],
        );
      } catch {
        setStarred([]);
      }
    };
    read();
    addEventListener("storage", read);
    return () => removeEventListener("storage", read);
  }, []);
  const toggle = (url: string) =>
    setStarred((current) => {
      const next = current.includes(url)
        ? current.filter((item) => item !== url)
        : [...current, url];
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* Memory-only when storage is unavailable. */
      }
      return next;
    });
  return { starred, toggle };
}
