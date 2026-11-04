// AUTHORED-BY Claude Opus 5.5
// The agent's work, shown as it happens: what it is thinking, what it opens or sends, and the
// policy check on every action (passed, blocked, or waiting for a person). Items appear one at
// a time so a story plays out rather than being described.
import type {
  Args,
  CallResult,
  GateDecision,
  Outcome,
  ToolSpec,
  Verdict,
} from "@jeswr/agent-sandbox";
import {
  Bot,
  Brain,
  Check,
  ChevronRight,
  Hourglass,
  Info,
  KeyRound,
  Loader2,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Json, OUTCOME_LABEL, outcomeOfResult, Steps } from "./components.js";
import { SystemBadge } from "./icons.js";

/** Who is acting, when several agents take part. */
export interface AgentTag {
  readonly name: string;
  readonly hue: number;
}

/** One thing in a trace. */
export type TraceItem =
  | { readonly kind: "user"; readonly id: string; readonly text: string; readonly who?: string }
  | {
      readonly kind: "thinking";
      readonly id: string;
      readonly text: string;
      readonly agent?: AgentTag;
    }
  | {
      readonly kind: "call";
      readonly id: string;
      readonly agent?: AgentTag;
      readonly tool?: ToolSpec;
      readonly toolName: string;
      readonly args: Args;
      readonly result: CallResult;
      readonly decision?: GateDecision;
      /** For stories: what the organisation wants, and whether it happened. */
      readonly expect?: Outcome;
      readonly why?: string;
      readonly verdict?: Verdict;
      readonly settled?: {
        readonly by: string;
        readonly approved: boolean;
        readonly result: CallResult;
      };
      /** Present when a person can answer a held call here. */
      readonly answer?: (approved: boolean) => void;
    }
  | {
      readonly kind: "notice";
      readonly id: string;
      readonly text: string;
      readonly tone: "grant" | "revoke" | "info" | "error";
    }
  | { readonly kind: "say"; readonly id: string; readonly text: string; readonly agent?: AgentTag }
  | { readonly kind: "node"; readonly id: string; readonly node: ReactNode };

/** How many reveal steps an item takes (a call shows the action, then its policy check). */
const units = (item: TraceItem) => (item.kind === "call" ? 2 : 1);

/** Whether traces appear at once (reduced motion). */
export function revealIsInstant(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Reveal a growing list a step at a time. New items keep appearing at the same pace; `instant`
 * shows everything at once (tests, reduced motion, "show all").
 */
export function useReveal(items: readonly TraceItem[], instant: boolean, stepMs = 650) {
  const total = items.reduce((n, i) => n + units(i), 0);
  const [shown, setShown] = useState(instant ? total : 0);
  const reduced = useRef(revealIsInstant());
  useEffect(() => {
    if (instant || reduced.current) {
      setShown(total);
      return;
    }
    if (shown > total) setShown(total);
    if (shown >= total) return;
    const next = items[visibleCount(items, shown)];
    const wait = next?.kind === "thinking" ? stepMs * 1.4 : stepMs;
    const t = setTimeout(() => setShown((s) => s + 1), wait);
    return () => clearTimeout(t);
  }, [instant, shown, total, items, stepMs]);
  return { shown: instant ? total : Math.min(shown, total), total, skip: () => setShown(total) };
}

/** How many whole items fit in `shown` reveal steps. */
function visibleCount(items: readonly TraceItem[], shown: number): number {
  let used = 0;
  let n = 0;
  for (const item of items) {
    if (used >= shown) break;
    used += units(item);
    n++;
  }
  return n;
}

/** A short, human description of what a call does. */
export function actionText(tool: ToolSpec | undefined, name: string, args: Args): string {
  const pick = [
    "to",
    "customer",
    "ticket",
    "email",
    "employee",
    "query",
    "segment",
    "sql",
    "summary",
    "message",
  ]
    .map((k) => args[k])
    .find((v) => typeof v === "string" || Array.isArray(v));
  const detail = Array.isArray(pick) ? pick.join(", ") : typeof pick === "string" ? pick : "";
  const short = detail.length > 48 ? `${detail.slice(0, 46)}…` : detail;
  return `${tool?.title ?? name}${short ? ` · ${short}` : ""}`;
}

/** The trace, revealed step by step. */
export function Trace({
  items,
  instant = false,
  busy = false,
}: {
  items: readonly TraceItem[];
  instant?: boolean;
  /** The agent is still working (shows a thinking indicator after the last item). */
  busy?: boolean;
}) {
  const { shown, total, skip } = useReveal(items, instant);
  let used = 0;
  const rows: ReactNode[] = [];
  for (const item of items) {
    if (used >= shown) break;
    const partial = item.kind === "call" && shown - used < 2;
    rows.push(<Row key={item.id} item={item} partial={partial} />);
    used += units(item);
  }
  const catchingUp = shown < total;
  return (
    <div className="trace">
      <ol className="trace-list">{rows}</ol>
      {(busy || catchingUp) && (
        <div className="trace-working">
          <Loader2 size={16} className="spin" aria-hidden="true" />
          <span>Working…</span>
          {catchingUp && (
            <button type="button" className="text-button" onClick={skip}>
              Show all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AgentName({ agent }: { agent?: AgentTag }) {
  if (!agent) return null;
  return (
    <span className="agent-tag" style={{ "--hue": agent.hue } as React.CSSProperties}>
      <Bot size={13} aria-hidden="true" />
      {agent.name}
    </span>
  );
}

function Row({ item, partial }: { item: TraceItem; partial: boolean }) {
  switch (item.kind) {
    case "user":
      return (
        <li className="t-user">
          <div className="bubble">
            {item.who && <span className="who">{item.who}</span>}
            {item.text}
          </div>
        </li>
      );
    case "thinking":
      return <Thinking item={item} />;
    case "say":
      return (
        <li className="t-say">
          <AgentName agent={item.agent} />
          <p>{item.text}</p>
        </li>
      );
    case "notice":
      return (
        <li className={`t-notice t-notice-${item.tone}`}>
          {item.tone === "grant" ? (
            <KeyRound size={15} aria-hidden="true" />
          ) : item.tone === "revoke" ? (
            <Undo2 size={15} aria-hidden="true" />
          ) : item.tone === "error" ? (
            <TriangleAlert size={15} aria-hidden="true" />
          ) : (
            <Info size={15} aria-hidden="true" />
          )}
          <span>{item.text}</span>
        </li>
      );
    case "node":
      return <li className="t-node">{item.node}</li>;
    default:
      return <Call item={item} partial={partial} />;
  }
}

function Thinking({ item }: { item: Extract<TraceItem, { kind: "thinking" }> }) {
  return (
    <li className="t-thinking">
      <AgentName agent={item.agent} />
      <div className="thinking">
        <Brain size={15} aria-hidden="true" />
        <span>{item.text}</span>
      </div>
    </li>
  );
}

function Call({ item, partial }: { item: Extract<TraceItem, { kind: "call" }>; partial: boolean }) {
  const outcome = outcomeOfResult(item.result);
  const failed = item.result.status === "failed";
  const [open, setOpen] = useState(false);
  return (
    <li className="t-call">
      <AgentName agent={item.agent} />
      <div className="action">
        {item.tool ? <SystemBadge system={item.tool.system} label={false} /> : null}
        <span className="action-text">{actionText(item.tool, item.toolName, item.args)}</span>
        <code className="action-tool">{item.toolName}</code>
      </div>
      {partial ? (
        <div className="oversight checking">
          <Loader2 size={15} className="spin" aria-hidden="true" />
          <span>Checking the policies…</span>
        </div>
      ) : (
        <div className={`oversight oversight-${failed ? "failed" : outcome}`}>
          <div className="oversight-head">
            {failed ? (
              <TriangleAlert size={16} aria-hidden="true" />
            ) : outcome === "permit" ? (
              <ShieldCheck size={16} aria-hidden="true" />
            ) : outcome === "stop" ? (
              <ShieldX size={16} aria-hidden="true" />
            ) : (
              <Hourglass size={16} aria-hidden="true" />
            )}
            <strong>
              {failed
                ? "The app reported an error"
                : outcome === "permit"
                  ? "Policy check passed"
                  : outcome === "stop"
                    ? "Blocked by policy"
                    : "Waiting for a person's approval"}
            </strong>
            <button
              type="button"
              className="why"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              Why <ChevronRight size={14} className={open ? "turned" : ""} aria-hidden="true" />
            </button>
          </div>
          {outcome !== "permit" || failed ? (
            <p className="oversight-text">
              {item.result.status === "done"
                ? item.decision?.summary
                : "message" in item.result
                  ? item.result.message.replace(/^Waiting for a person's approval:\s*/i, "")
                  : ""}
            </p>
          ) : null}
          {item.decision?.shadow && item.decision.shadow !== outcome && (
            <p className="oversight-shadow">
              The written rules would have said{" "}
              <strong>{OUTCOME_LABEL[item.decision.shadow]}</strong>.
            </p>
          )}
          {item.result.status === "held" && !item.settled && item.answer && (
            <div className="oversight-actions">
              <button type="button" className="primary small" onClick={() => item.answer?.(true)}>
                <Check size={14} aria-hidden="true" /> Approve
              </button>
              <button type="button" className="small" onClick={() => item.answer?.(false)}>
                Decline
              </button>
            </div>
          )}
          {item.settled && (
            <p className="oversight-settled">
              {item.settled.approved ? "Approved" : "Declined"} by {item.settled.by}.{" "}
              {item.settled.result.status === "done"
                ? "It then went ahead."
                : item.settled.approved && "message" in item.settled.result
                  ? item.settled.result.message
                  : ""}
            </p>
          )}
          {open && (
            <div className="oversight-details">
              {item.decision && <Steps decision={item.decision} />}
              <span className="eyebrow">What the agent asked for</span>
              <Json value={item.args} />
              {item.result.status === "done" && (
                <>
                  <span className="eyebrow">What it got back</span>
                  <Json value={item.result.content} />
                </>
              )}
            </div>
          )}
        </div>
      )}
      {!partial && item.expect && (
        <p className={`expect expect-${item.verdict}`}>
          {item.verdict === "right"
            ? "✓ What Harbour & Finch wants."
            : `✕ Harbour & Finch wants “${OUTCOME_LABEL[item.expect]}”.`}{" "}
          {item.why && <span className="hint">{item.why}</span>}
        </p>
      )}
    </li>
  );
}
