// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/**
 * The approval sheet and the spending-limit editor. Everything shown here comes from the
 * ApprovalRequest the gate wrote; the sheet offers only the responses in `offered`.
 * Confirming signs a record with this device's key (the engine does the signing).
 */
import {
  type ApprovalRequest,
  formatMoney,
  type OfferedResponse,
  type PrincipalResponse,
  type RuleDraft,
  type RuleScope,
  summarizeDraft,
} from "@jeswr/agent-consent";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductView } from "../engine/types.js";
import { AGENT_NAME } from "../engine/world.js";
import { Icon, ProductArt, Seal } from "./art.js";
import { CheckList, FactRow, Meter } from "./chat.js";

const EXPLORER = "https://claude.ai/artifact/CeeevpC9wCwDyzcGDMrpPw";

export function HoldToConfirm({
  label,
  onConfirm,
  primary = true,
}: {
  label: string;
  onConfirm: () => void;
  primary?: boolean;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = () => {
    setHolding(true);
    timer.current = setTimeout(() => {
      setHolding(false);
      onConfirm();
    }, 1200);
  };
  const cancel = () => {
    setHolding(false);
    clearTimeout(timer.current);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`btn block hold ${primary ? "primary" : ""} ${holding ? "holding" : ""}`}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !holding && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") cancel();
      }}
      aria-label={`${label} (press and hold)`}
    >
      <span className="ring" />
      <span>{holding ? "Keep holding…" : label}</span>
    </button>
  );
}

/** The device confirmation: the engine signs with the non-extractable device key. */
function DevicePrompt({ kid, onDone }: { kid?: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 900);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="device" role="dialog" aria-label="Confirm on this device">
      <div className="panel">
        <div className="print signing">
          <Icon name="fingerprint" size={40} />
        </div>
        <strong>Confirming on this device</strong>
        <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>
          Signing with this device's key. The key never leaves this device.
        </div>
        {kid && <div className="kid">key {kid.slice(0, 24)}…</div>}
      </div>
    </div>
  );
}

function FaceCheck({ by, onDone }: { by: string; onDone: () => void }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDone(true), 2600);
    const u = setTimeout(onDone, 3600);
    return () => {
      clearTimeout(t);
      clearTimeout(u);
    };
  }, [onDone]);
  return (
    <div className="device" role="dialog" aria-label="Face check">
      <div className="panel">
        <div className="face">
          {!done && <div className="scan" />}
          <Icon name="face" size={100} />
        </div>
        <strong>{done ? "Face check complete" : "Hold still"}</strong>
        <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>
          {done
            ? `${by} confirmed it is you. Your photo was not kept by ${AGENT_NAME}.`
            : `${by} is checking it is you.`}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
          Simulated in this demo: no camera is used.
        </div>
      </div>
    </div>
  );
}

const KIND_LABEL = {
  "per-purchase": "Each purchase",
  budget: "Budget",
  allowance: "Allowance",
} as const;
const UNTIL = [
  { id: "3m", label: "3 months" },
  { id: "1y", label: "1 year" },
  { id: "off", label: "Until I turn it off" },
] as const;

function addMonths(now: Date, months: number): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

export function LimitEditor({
  offered,
  request,
  onCancel,
  onConfirm,
}: {
  offered: OfferedResponse;
  request: ApprovalRequest;
  onCancel: () => void;
  onConfirm: (draft: RuleDraft) => void;
}) {
  const start = offered.draft as RuleDraft;
  const action = request.action.type === "purchase" ? request.action : undefined;
  const currency = start.limit.currency;
  const [kind, setKind] = useState(start.kind);
  const [period, setPeriod] = useState(start.period ?? "month");
  const [amount, setAmount] = useState(String(start.limit.minor / 100));
  const [scopeKind, setScopeKind] = useState<RuleScope["kind"]>(start.scope.kind);
  const [capOn, setCapOn] = useState(Boolean(start.perPurchaseMax));
  const [cap, setCap] = useState(
    String((start.perPurchaseMax?.minor ?? start.limit.minor / 2) / 100),
  );
  const [until, setUntil] = useState<(typeof UNTIL)[number]["id"]>(start.expiresAt ? "3m" : "off");
  const now = new Date();
  const minor = Math.round(Number(amount) * 100);
  const valid =
    Number.isFinite(minor) && minor > 0 && minor <= 1_000_000 && /^\d+(\.\d{1,2})?$/.test(amount);
  const forcedCap = scopeKind === "any" && kind !== "per-purchase";
  const capMinor = Math.round(Number(cap) * 100);
  const useCap =
    kind !== "per-purchase" && (capOn || forcedCap) && capMinor > 0 && capMinor <= minor;
  const merchant = action?.recipient;
  const scope: RuleScope =
    scopeKind === "merchant" && merchant
      ? { kind: "merchant", merchant: merchant.id, label: merchant.name }
      : scopeKind === "category" && action
        ? {
            kind: "category",
            category: action.category,
            label: action.category[0]?.toUpperCase() + action.category.slice(1),
          }
        : { kind: "any" };
  const expiresAt =
    until === "off"
      ? undefined
      : until === "1y"
        ? addMonths(now, 12)
        : kind === "allowance"
          ? undefined
          : addMonths(now, 3);
  const draft: RuleDraft = {
    kind,
    limit: { minor: valid ? minor : 0, currency },
    scope,
    ...(kind === "budget" ? { period } : {}),
    ...(useCap ? { perPurchaseMax: { minor: capMinor, currency } } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
  const fits =
    action &&
    valid &&
    (kind === "per-purchase" ? action.total.minor <= minor : action.total.minor <= minor) &&
    (!useCap || action.total.minor <= capMinor);
  const sentence = valid ? summarizeDraft(draft, AGENT_NAME, now) : "Enter an amount.";
  const usedBefore = request.meter && offered.type === "raise-limit" ? request.meter.used.minor : 0;
  return (
    <div className="editor">
      <div className="sheet-seal">
        <Seal /> {offered.type === "raise-limit" ? "Raise your limit" : "Set a spending limit"}
      </div>
      <fieldset className="segment" aria-label="Kind of limit">
        {(["per-purchase", "budget", "allowance"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </fieldset>
      {kind === "budget" && (
        <>
          <div className="lbl">Every</div>
          <fieldset className="segment" aria-label="Budget period">
            {(["week", "month"] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
              >
                {p === "week" ? "Week" : "Month"}
              </button>
            ))}
          </fieldset>
        </>
      )}
      <label className="lbl" htmlFor="amount">
        {kind === "per-purchase"
          ? "Up to, per purchase"
          : kind === "allowance"
            ? "Total allowance"
            : `Up to, per ${period}`}
      </label>
      <div className="amount num">
        $
        <input
          id="amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
        />
      </div>
      <div className="chips" style={{ marginTop: 6 }}>
        {(offered.suggested ?? []).map((s) => (
          <button
            key={s}
            type="button"
            className="chip num"
            aria-pressed={minor === s}
            style={
              minor === s
                ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 }
                : {}
            }
            onClick={() => setAmount(String(s / 100))}
          >
            {formatMoney({ minor: s, currency })}
          </button>
        ))}
      </div>
      <div className="lbl">Where</div>
      <fieldset className="segment" aria-label="Where the limit applies">
        <button
          type="button"
          aria-pressed={scopeKind === "merchant"}
          onClick={() => setScopeKind("merchant")}
        >
          This store
        </button>
        {action && (
          <button
            type="button"
            aria-pressed={scopeKind === "category"}
            onClick={() => setScopeKind("category")}
          >
            {action.category[0]?.toUpperCase() + action.category.slice(1)}
          </button>
        )}
        <button
          type="button"
          aria-pressed={scopeKind === "any"}
          onClick={() => setScopeKind("any")}
        >
          Any store
        </button>
      </fieldset>
      {forcedCap && (
        <div className="caution">Any store is broad, so each purchase also has a cap.</div>
      )}
      {kind !== "per-purchase" && (
        <div className="row" style={{ marginTop: 14 }}>
          <span className="grow" style={{ fontSize: 14 }}>
            Ask first above
          </span>
          {(capOn || forcedCap) && (
            <span className="num">
              $
              <input
                className="small-input"
                aria-label="Ask first above amount"
                value={cap}
                onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ""))}
              />
            </span>
          )}
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={capOn || forcedCap}
            aria-label="Ask first above an amount"
            disabled={forcedCap}
            onClick={() => setCapOn(!capOn)}
          />
        </div>
      )}
      <div className="lbl">Until</div>
      <fieldset className="segment" aria-label="Until">
        {UNTIL.map((u) => (
          <button
            key={u.id}
            type="button"
            aria-pressed={until === u.id}
            onClick={() => setUntil(u.id)}
          >
            {kind === "allowance" && u.id === "3m" ? "When used up" : u.label}
          </button>
        ))}
      </fieldset>
      <div className="summary" aria-live="polite">
        {sentence}
      </div>
      {action && valid && (
        <div className="effect">
          {fits
            ? `${action.items[0]?.name} (${formatMoney(action.total)}) will be ${usedBefore ? "covered" : "the first purchase"}. ${kind === "per-purchase" ? "" : `${formatMoney({ minor: Math.max(0, minor - usedBefore - action.total.minor), currency })} left${kind === "budget" ? ` this ${period}` : ""}.`}`
            : `This limit does not cover ${action.items[0]?.name} (${formatMoney(action.total)}), so I would still ask.`}
        </div>
      )}
      <div className="actions">
        {valid ? (
          <HoldToConfirm label="Hold to set limit" onConfirm={() => onConfirm(draft)} />
        ) : (
          <button type="button" className="btn primary block" disabled>
            Hold to set limit
          </button>
        )}
        <button type="button" className="btn text" onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}

type Mode =
  | { type: "sheet" }
  | { type: "editor"; offered: OfferedResponse }
  | { type: "device"; response: PrincipalResponse }
  | { type: "face"; offered: OfferedResponse };

export function ApprovalSheet({
  request,
  kid,
  products,
  onRespond,
  onClose,
}: {
  request: ApprovalRequest;
  kid?: string;
  products: readonly ProductView[];
  onRespond: (r: PrincipalResponse) => Promise<{ ok: boolean; reason?: string }>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>({ type: "sheet" });
  const [whyOpen, setWhyOpen] = useState(false);
  const [error, setError] = useState<string>();
  const action = request.action;
  const offeredFields =
    action.type === "share" ? action.fields.filter((f) => f.state === "offered") : [];
  const [keep, setKeep] = useState<Set<string>>(() => new Set(offeredFields.map((f) => f.id)));
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  const send = useCallback(
    async (r: PrincipalResponse) => {
      const result = await onRespond(r);
      if (!result.ok) {
        setError(
          result.reason === "expired"
            ? "This request expired. Ask me again."
            : "That answer was not accepted.",
        );
        setMode({ type: "sheet" });
      }
    },
    [onRespond],
  );

  const choose = (o: OfferedResponse) => {
    if (o.type === "deny")
      return void send({
        requestId: request.id,
        digest: request.digest,
        type: "deny",
        offeredId: o.id,
      });
    if (o.type === "set-limit" || o.type === "raise-limit")
      return setMode({ type: "editor", offered: o });
    if (o.type === "step-up-done") return setMode({ type: "face", offered: o });
    if (o.type === "approve-once" && action.type === "share" && keep.size < offeredFields.length) {
      const less = request.offered.find((x) => x.type === "share-less");
      if (less)
        return setMode({
          type: "device",
          response: {
            requestId: request.id,
            digest: request.digest,
            type: "share-less",
            offeredId: less.id,
            keep: [...keep],
          },
        });
    }
    if (o.type === "approve-once")
      return setMode({
        type: "device",
        response: {
          requestId: request.id,
          digest: request.digest,
          type: "approve-once",
          offeredId: o.id,
        },
      });
  };

  const missingRequired = offeredFields.some((f) => f.required && !keep.has(f.id));
  const visible = request.offered.filter((o) => o.type !== "share-less");
  const primary = visible.filter((o) => o.role === "primary");
  const standing = visible.filter((o) => o.role === "standing");
  const deny = visible.find((o) => o.role === "deny");
  const minutes = Math.max(0, Math.round((Date.parse(request.expiresAt) - Date.now()) / 60000));
  const thumbs =
    action.type === "purchase"
      ? action.items
          .map((i) => products.find((p) => p.name === i.name))
          .filter((p): p is ProductView => Boolean(p))
      : [];

  return (
    <>
      <div className="scrim docked" />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        tabIndex={-1}
        ref={sheetRef}
        onKeyDown={(e) => e.key === "Escape" && deny && mode.type === "sheet" && choose(deny)}
      >
        <div className="handle" />
        {mode.type === "editor" ? (
          <LimitEditor
            offered={mode.offered}
            request={request}
            onCancel={() => setMode({ type: "sheet" })}
            onConfirm={(draft) =>
              setMode({
                type: "device",
                response: {
                  requestId: request.id,
                  digest: request.digest,
                  type: mode.offered.type as "set-limit" | "raise-limit",
                  offeredId: mode.offered.id,
                  draft,
                },
              })
            }
          />
        ) : (
          <>
            <div className="sheet-seal">
              <Seal /> {AGENT_NAME} needs your OK
            </div>
            <h2 id="sheet-title">{request.title}</h2>
            <p className="reason">{request.plainReason}</p>
            {request.historyNote && <p className="history">{request.historyNote}</p>}
            {thumbs.length > 0 && (
              <div className="thumbs">
                {thumbs.map((p) => (
                  <div key={p.id} className="thumb">
                    <ProductArt art={p.art} color={p.color} />
                  </div>
                ))}
              </div>
            )}
            {request.meter && (
              <Meter
                used={request.meter.used}
                limit={request.meter.limit}
                after={request.meter.after}
                resetsAt={request.meter.resetsAt}
              />
            )}
            {action.type === "share" && (
              <div className="fields">
                {offeredFields.map((f) => (
                  <div key={f.id} className="field">
                    <div className="fl">
                      <strong>{f.label}</strong>
                      <span>
                        {f.preview} · {f.source}
                      </span>
                    </div>
                    {f.required && <span className="req">Needed</span>}
                    <button
                      type="button"
                      className="switch"
                      role="switch"
                      aria-label={`Share ${f.label}`}
                      aria-checked={keep.has(f.id)}
                      onClick={() => {
                        const next = new Set(keep);
                        if (next.has(f.id)) next.delete(f.id);
                        else next.add(f.id);
                        setKeep(next);
                      }}
                    />
                  </div>
                ))}
                {missingRequired && (
                  <div className="warn">{action.recipient.name} cannot decide without this.</div>
                )}
                {action.fields.some((f) => f.state === "withheld-by-gate") && (
                  <div className="not-shared">Not shared</div>
                )}
                {action.fields
                  .filter((f) => f.state === "withheld-by-gate")
                  .map((f) => (
                    <div key={f.id} className="field withheld-row">
                      <div className="fl">
                        <strong>{f.label}</strong>
                        <span>{f.withheldReason}</span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
            <dl className="facts">
              {request.facts.map((f) => (
                <FactRow
                  key={`${f.label}:${f.value}`}
                  label={f.label}
                  value={f.value}
                  emphasis={f.emphasis}
                />
              ))}
            </dl>
            {error && <div className="warn">{error}</div>}
            <div className="actions">
              {primary.map((o) => {
                const label =
                  o.type === "approve-once" && action.type === "share"
                    ? `Share ${keep.size}`
                    : o.label;
                const disabled = missingRequired || (action.type === "share" && keep.size === 0);
                return o.confirm === "tap" ? (
                  <button
                    key={o.id}
                    type="button"
                    className="btn primary block"
                    disabled={disabled}
                    onClick={() => choose(o)}
                  >
                    {label}
                  </button>
                ) : o.type === "set-limit" ||
                  o.type === "raise-limit" ||
                  o.type === "step-up-done" ? (
                  <button
                    key={o.id}
                    type="button"
                    className="btn primary block"
                    onClick={() => choose(o)}
                  >
                    {label}
                  </button>
                ) : disabled ? (
                  <button key={o.id} type="button" className="btn primary block" disabled>
                    {label}
                  </button>
                ) : (
                  <HoldToConfirm key={o.id} label={label} onConfirm={() => choose(o)} />
                );
              })}
              {standing.map((o) =>
                o.type === "approve-once" ? (
                  o.confirm === "tap" ? (
                    <button
                      key={o.id}
                      type="button"
                      className="btn block"
                      onClick={() => choose(o)}
                    >
                      {o.label}
                    </button>
                  ) : (
                    <HoldToConfirm
                      key={o.id}
                      label={o.label}
                      primary={false}
                      onConfirm={() => choose(o)}
                    />
                  )
                ) : (
                  <button key={o.id} type="button" className="btn block" onClick={() => choose(o)}>
                    {o.label}
                  </button>
                ),
              )}
              {deny && (
                <button type="button" className="btn text" onClick={() => choose(deny)}>
                  {deny.label}
                </button>
              )}
            </div>
            {request.standingWithheldReason && (
              <div className="withheld">
                <Icon name="lock" size={14} /> {request.standingWithheldReason}
              </div>
            )}
            <div className={`why ${whyOpen ? "open" : ""}`}>
              <button type="button" aria-expanded={whyOpen} onClick={() => setWhyOpen(!whyOpen)}>
                Why am I being asked? <Icon name="chev" size={16} />
              </button>
              {whyOpen && (
                <>
                  <CheckList checks={request.checks} />
                  <div className="why-foot">
                    <span>
                      Outcome: ask the principal. This request was written by the gate from the
                      action itself, not by the AI model.
                    </span>
                    <span className="num">Action digest {request.digest.slice(8, 24)}…</span>
                    <a href={EXPLORER} target="_blank" rel="noreferrer">
                      Open the trace explorer <Icon name="external" size={12} />
                    </a>
                  </div>
                </>
              )}
            </div>
            <div className="expiry">
              This request expires in {minutes} minutes. Approvals are single use and bound to this
              exact action.
            </div>
            <button type="button" className="sr-only" onClick={onClose}>
              Close and decide later
            </button>
          </>
        )}
      </div>
      {mode.type === "device" && <DevicePrompt kid={kid} onDone={() => void send(mode.response)} />}
      {mode.type === "face" && action.type === "step-up" && (
        <FaceCheck
          by={action.performedBy}
          onDone={() =>
            void send({
              requestId: request.id,
              digest: request.digest,
              type: "step-up-done",
              offeredId: mode.offered.id,
              attestation: "face-check",
            })
          }
        />
      )}
    </>
  );
}
