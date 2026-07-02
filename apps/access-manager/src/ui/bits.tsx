// AUTHORED-BY Claude Fable 5
//
// Small shared UI bits: the optimistic-mutation saving indicator (suite UX
// invariant #2 — act immediately, persist async, revert + surface on failure),
// agent labels (profile-resolved names), mode badges, and the public-access flag.

import { useEffect, useRef, useState } from "react";
import type { WacMode } from "../lib/acl.js";
import { AUTHENTICATED_AGENT, PUBLIC_AGENT } from "../lib/grants.js";
import type { SolidFetch } from "../lib/http.js";
import { resolveAgentDisplay } from "../lib/profile.js";

export type SavingState = "idle" | "saving" | "saved" | "error";

/** Non-blocking Saving…/Saved/Failed indicator driven by a SavingState. */
export function SavingIndicator({ state, error }: { state: SavingState; error?: string | null }) {
  if (state === "idle") return null;
  return (
    <span
      role="status"
      aria-live="polite"
      className={`saving-indicator saving-${state}`}
      data-testid="saving-indicator"
    >
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : (error ?? "Failed to save")}
    </span>
  );
}

/**
 * Run an optimistic mutation: `apply` updates local state immediately,
 * `persist` writes to the pod, `revert` undoes on failure. Exposes the saving
 * state for the indicator.
 */
export function useOptimistic(): {
  state: SavingState;
  error: string | null;
  run: (mutation: {
    apply: () => void;
    persist: () => Promise<void>;
    revert: () => void;
  }) => Promise<boolean>;
} {
  const [state, setState] = useState<SavingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const run = async (mutation: {
    apply: () => void;
    persist: () => Promise<void>;
    revert: () => void;
  }): Promise<boolean> => {
    mutation.apply();
    setState("saving");
    setError(null);
    try {
      await mutation.persist();
      setState("saved");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 2000);
      return true;
    } catch (e) {
      mutation.revert();
      setState("error");
      setError(e instanceof Error ? e.message : "The change could not be saved.");
      return false;
    }
  };

  return { state, error, run };
}

/** A human label for an agent line (public/authenticated sentinels + WebIDs). */
export function AgentLabel({ agent, fetchFn }: { agent: string; fetchFn: SolidFetch }) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (agent === PUBLIC_AGENT || agent === AUTHENTICATED_AGENT) return;
    let cancelled = false;
    resolveAgentDisplay(agent, fetchFn).then((d) => {
      if (!cancelled && d.name !== agent) setName(d.name);
    });
    return () => {
      cancelled = true;
    };
  }, [agent, fetchFn]);

  if (agent === PUBLIC_AGENT) {
    return (
      <span className="agent public-agent" data-testid="public-agent">
        ⚠ Anyone on the web
      </span>
    );
  }
  if (agent === AUTHENTICATED_AGENT) {
    return <span className="agent authenticated-agent">Any logged-in agent</span>;
  }
  return (
    <span className="agent" title={agent}>
      {name ?? shortenWebId(agent)}
    </span>
  );
}

export function shortenWebId(webId: string): string {
  try {
    const u = new URL(webId);
    return u.hostname + (u.hash ? u.hash : "");
  } catch {
    return webId;
  }
}

export function ModeBadges({ modes }: { modes: readonly WacMode[] }) {
  return (
    <span className="mode-badges">
      {modes.map((m) => (
        <span key={m} className={`mode-badge mode-${m.toLowerCase()}`}>
          {m}
        </span>
      ))}
    </span>
  );
}

/** Path-ish label for a resource within the storage. */
export function resourceLabel(url: string, storageRoot: string | null): string {
  if (storageRoot && url.startsWith(storageRoot)) {
    const rest = url.slice(storageRoot.length);
    return rest === "" ? "/ (whole pod)" : `/${rest}`;
  }
  return url;
}
