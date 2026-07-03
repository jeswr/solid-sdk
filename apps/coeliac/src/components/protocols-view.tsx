// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The Protocols / Challenges view (DESIGN §3, Brief 2B) — run an elimination
 * challenge: start one from a suspicion, advance the phases, record outcomes, and
 * review concluded challenges. Reads are cache-only (instant, offline); writes are
 * optimistic (UX invariant #2) and refresh both hooks on completion.
 *
 * SAFETY is delegated to the pure FSM through {@link useProtocolActions} — this
 * component NEVER decides a transition. A refusal (gluten / emergency trigger / a
 * challenge already in progress) is surfaced verbatim and nothing is written. Every
 * challenge is framed as a suggestion with the clinician caveat, and is abortable.
 */
import { useCallback, useState } from "react";
import type { StoredConclusion, StoredProtocol } from "@/lib/cache/diary-store";
import { triggerLabel } from "@/lib/off/exposure-display";
import { CLINICIAN_CAVEAT, nextAction, type ProtocolEvent, promptFor } from "@/lib/protocol/fsm";
import { storedProtocolToData } from "@/lib/protocol/persist";
import { useInsights } from "@/lib/session/use-insights";
import { useProtocolActions } from "@/lib/session/use-protocol-actions";
import { useProtocols } from "@/lib/session/use-protocols";

const PHASE_LABEL: Record<string, string> = {
  baseline: "Baseline",
  eliminate: "Eliminating",
  washout: "Washout",
  reintroduce: "Reintroducing",
  observe: "Observing",
  concluded: "Concluded",
};

const VERDICT_LABEL: Record<string, string> = {
  tolerated: "Tolerated",
  reacts: "Reacts",
  "dose-dependent": "Dose-dependent",
  inconclusive: "Inconclusive",
};

function fmtDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString();
}

/** A single active challenge with its phase, supportive prompt, and next actions. */
function ActiveChallengeCard({
  protocol,
  busy,
  onEvent,
}: {
  protocol: StoredProtocol;
  busy: boolean;
  onEvent: (p: StoredProtocol, e: ProtocolEvent) => void;
}) {
  const data = storedProtocolToData(protocol);
  const prompt = promptFor(data);
  const na = nextAction(data);
  const due = fmtDate(protocol.phasePlannedEnd);

  return (
    <li className={`protocol protocol--${protocol.phase}`}>
      <div className="protocol__head">
        <span className="protocol__trigger">{triggerLabel(protocol.targetTrigger)}</span>
        <span className={`protocol__phase protocol__phase--${protocol.phase}`}>
          {PHASE_LABEL[protocol.phase] ?? protocol.phase}
        </span>
      </div>
      <p className="protocol__prompt">{prompt.message}</p>
      {due ? <p className="protocol__due">Planned through {due}.</p> : null}

      <div className="protocol__actions">
        {protocol.phase === "eliminate" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onEvent(protocol, { type: "advance-phase", symptomsImproved: true })}
            >
              I felt better
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onEvent(protocol, { type: "advance-phase", symptomsImproved: false })}
            >
              No change
            </button>
          </>
        ) : protocol.phase === "observe" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onEvent(protocol, { type: "record-outcome", reacted: true })}
            >
              I reacted
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onEvent(protocol, { type: "record-outcome", reacted: false })}
            >
              No reaction
            </button>
          </>
        ) : na.event ? (
          <button type="button" disabled={busy} onClick={() => onEvent(protocol, na.event!)}>
            {na.label}
          </button>
        ) : null}

        <button
          type="button"
          className="protocol__abort"
          disabled={busy}
          onClick={() => onEvent(protocol, { type: "abort" })}
        >
          Stop this challenge
        </button>
      </div>
    </li>
  );
}

function ConcludedCard({
  protocol,
  conclusion,
}: {
  protocol: StoredProtocol;
  conclusion?: StoredConclusion;
}) {
  return (
    <li className="protocol protocol--concluded">
      <div className="protocol__head">
        <span className="protocol__trigger">{triggerLabel(protocol.targetTrigger)}</span>
        {conclusion ? (
          <span className={`protocol__verdict protocol__verdict--${conclusion.verdict}`}>
            {VERDICT_LABEL[conclusion.verdict] ?? conclusion.verdict}
          </span>
        ) : (
          <span className="protocol__verdict">Concluded</span>
        )}
      </div>
      {conclusion?.note ? <p className="protocol__note">{conclusion.note}</p> : null}
      {conclusion?.reviewAfter ? (
        <p className="protocol__review">Worth re-testing after {fmtDate(conclusion.reviewAfter)}.</p>
      ) : null}
    </li>
  );
}

export function ProtocolsView() {
  const { active, concluded, conclusions, safety, loaded, refresh } = useProtocols();
  const insights = useInsights();
  const { startChallenge, advanceChallenge } = useProtocolActions();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const conclusionByProtocol = new Map(conclusions.map((c) => [c.protocolUlid, c]));
  const proposal = insights.result?.proposal;
  const canStart = active.length === 0;

  // Refresh both views from the cache (repaints the sync badge when a write settles).
  const repaint = useCallback(
    () => Promise.all([refresh(), insights.refresh()]),
    [refresh, insights],
  );

  const onEvent = useCallback(
    async (protocol: StoredProtocol, event: ProtocolEvent) => {
      setBusy(true);
      setNotice(null);
      try {
        const res = await advanceChallenge(protocol, event, safety);
        if ("rejected" in res) {
          setNotice(res.message); // nothing was written
        } else {
          // Optimistic: the cache is ALREADY written; the pod write finishes in the
          // background (retried by the outbox on failure) and repaints on settle.
          void res.syncing.catch(() => {}).finally(() => void repaint());
        }
      } finally {
        await repaint(); // paint the local change immediately (do NOT await the pod write)
        setBusy(false);
      }
    },
    [advanceChallenge, safety, repaint],
  );

  const onStart = useCallback(
    async (trigger: string) => {
      setBusy(true);
      setNotice(null);
      try {
        const res = await startChallenge(
          { trigger: trigger as Parameters<typeof startChallenge>[0]["trigger"] },
          safety,
        );
        if ("refused" in res) setNotice(res.message);
        else void res.syncing.catch(() => {}).finally(() => void repaint());
      } finally {
        await repaint();
        setBusy(false);
      }
    },
    [startChallenge, safety, repaint],
  );

  return (
    <div className="protocols">
      <h1>Elimination challenges</h1>
      <p className="protocols__intro">
        An elimination challenge is a careful way to test whether one food really affects you: you
        leave it out for a while, then reintroduce it in small steps and watch what happens. {CLINICIAN_CAVEAT}
      </p>

      {notice ? (
        <aside className="protocols__notice" role="note">
          {notice}
        </aside>
      ) : null}

      <section className="protocols__active" aria-label="Active challenges">
        <h2>Active</h2>
        {!loaded ? (
          <p className="protocols__loading">Loading your challenges…</p>
        ) : active.length === 0 ? (
          <p className="protocols__none">No challenge is running right now.</p>
        ) : (
          <ul className="protocol-list">
            {active.map((p) => (
              <ActiveChallengeCard key={p.ulid} protocol={p} busy={busy} onEvent={onEvent} />
            ))}
          </ul>
        )}
      </section>

      <section className="protocols__start" aria-label="Start a challenge">
        <h2>Start a challenge</h2>
        {!canStart ? (
          <p className="protocols__start-blocked">
            Finish or stop your current challenge first — testing one trigger at a time is the only
            way to know which one is responsible.
          </p>
        ) : proposal && proposal.kind === "eliminate" && proposal.trigger ? (
          <div className="protocols__proposal">
            <p>{proposal.rationale}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => onStart(proposal.trigger as string)}
            >
              Start a {triggerLabel(proposal.trigger)} challenge
            </button>
          </div>
        ) : (
          <p className="protocols__no-proposal">
            No challenge is suggested yet. Keep logging meals and symptoms — a suggestion appears on
            your Insights page once a clearer pattern emerges. A challenge is always your choice,
            never automatic.
          </p>
        )}
      </section>

      {concluded.length > 0 ? (
        <section className="protocols__concluded" aria-label="Concluded challenges">
          <h2>Concluded</h2>
          <ul className="protocol-list">
            {concluded.map((p) => (
              <ConcludedCard key={p.ulid} protocol={p} conclusion={conclusionByProtocol.get(p.ulid)} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
