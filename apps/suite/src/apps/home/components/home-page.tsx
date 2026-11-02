// AUTHORED-BY Claude Opus 5.5
"use client";
/** Placeholder for HM-03 (header, domain navigation and typed cards grid). */

import { DOMAINS, UNCATEGORISED } from "../lib/model/domains";

export function HomePage({ domain }: { domain: string }) {
  const entry = DOMAINS.find((candidate) => candidate.id === domain) ?? UNCATEGORISED;
  return (
    <div className="hm-page">
      <h1>{entry.label}</h1>
      <p>{entry.description}</p>
    </div>
  );
}
