/** biome-ignore-all lint/performance/noImgElement: Package supports local and blob assets without a Next image loader. */
// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useState } from "react";
import { cn } from "../../lib/utils.js";
export type ProvenanceBadgeProps = { source: string; logoSrc?: string; className?: string };
/** Root-relative local assets only; never load third-party connector images. */
export function isLocalLogo(src: string): boolean {
  return (
    src.startsWith("/") &&
    !src.startsWith("//") &&
    !src.includes("\\") &&
    Array.from(src).every((char) => char.charCodeAt(0) > 32 && char.charCodeAt(0) !== 127)
  );
}
export function ProvenanceBadge({ source, logoSrc, className }: ProvenanceBadgeProps) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const label = source.trim() || "Unknown source";
  const logo = logoSrc && isLocalLogo(logoSrc) && failedSrc !== logoSrc ? logoSrc : undefined;
  return (
    <span className={cn("suite-provenance", className)}>
      <span className="suite-provenance-logo" aria-hidden="true">
        {logo ? (
          <img src={logo} alt="" width={16} height={16} onError={() => setFailedSrc(logo)} />
        ) : (
          Array.from(label)[0]?.toLocaleUpperCase()
        )}
      </span>
      <span>Provided by {label}</span>
    </span>
  );
}
