// AUTHORED-BY Claude Fable 5
"use client";

import { cn } from "@jeswr/app-shell";
import { useState } from "react";
import type { DemoPersonaCard, PersonaField } from "../schema.js";

function CopyRow({ label, value, copyable, note }: PersonaField) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions/insecure context): the value stays selectable.
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 border-border border-b py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="truncate font-medium text-card-foreground text-sm tabular-nums">{value}</p>
        {note !== undefined && <p className="text-muted-foreground text-xs">{note}</p>}
      </div>
      {copyable !== false && (
        <button
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-muted-foreground text-xs hover:bg-muted"
          onClick={() => void copy()}
          type="button"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}

export interface DemoIdentityCardProps {
  persona: DemoPersonaCard;
  className?: string | undefined;
}

/**
 * Copy-ready demo identity: the scripted persona's values, one click from the
 * presenter's clipboard. The descriptor (validated to self-identify as
 * fictional/simulated) and the optional footnote render verbatim.
 */
export function DemoIdentityCard({ persona, className }: DemoIdentityCardProps) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-card p-5", className)}
      data-demo-identity-card=""
    >
      <h3 className="font-semibold text-card-foreground">Demo identity — {persona.name}</h3>
      <p className="mt-1 text-muted-foreground text-sm">{persona.descriptor}</p>
      <div className="mt-3">
        {persona.fields.map((field) => (
          <CopyRow key={field.label} {...field} />
        ))}
      </div>
      {persona.footnote !== undefined && (
        <p className="mt-3 text-muted-foreground text-xs">{persona.footnote}</p>
      )}
    </div>
  );
}
