// AUTHORED-BY Claude Opus 5.5
import { type CheckLine, formatMoney, type Money, shortDate } from "@jeswr/agent-consent";
import { useEffect, useRef, useState } from "react";
import type { Session } from "../engine/session.js";
import type { ChatMessage, EngineState, ProductView } from "../engine/types.js";
import { AGENT_NAME, PRINCIPAL } from "../engine/world.js";
import { Icon, ProductArt, Seal } from "./art.js";

export const STARTERS = [
  "Find me running sneakers under $25",
  "Get a mortgage decision in principle",
  "Reorder my usual socks",
  "What can you do without asking me?",
];

const CHECK_WORDS: Record<string, string> = {
  "limits-and-approval": "Limits and approval",
  "data-terms": "Data terms",
};
const RESULT_WORDS: Record<CheckLine["result"], string> = {
  pass: "Passed",
  ask: "Ask the principal",
  fail: "Stop",
  pending: "",
  "not-applicable": "Not applicable",
};
const GLYPH: Record<CheckLine["result"], string> = {
  pass: "✓",
  ask: "?",
  fail: "✕",
  pending: "·",
  "not-applicable": "–",
};

export function CheckList({ checks }: { checks: readonly CheckLine[] }) {
  return (
    <ul className="checklist">
      {checks.map((c) => (
        <li key={c.check} className={c.result}>
          <span className={`glyph ${c.result}`} aria-hidden="true">
            {GLYPH[c.result]}
          </span>
          <span>
            <span className="cname">{CHECK_WORDS[c.check] ?? c.check}</span>
            {RESULT_WORDS[c.result] && <span className="res">{RESULT_WORDS[c.result]}</span>}
            <br />
            <span className="muted">{c.plain}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Meter({
  used,
  limit,
  after,
  resetsAt,
  drain,
}: {
  used: Money;
  limit: Money;
  after?: Money;
  resetsAt?: string;
  drain?: boolean;
}) {
  const total = Math.max(limit.minor, after?.minor ?? 0);
  const usedPct = Math.min(100, (used.minor / limit.minor) * 100);
  const afterPct = after
    ? Math.min(100, (Math.min(after.minor, limit.minor) / limit.minor) * 100)
    : usedPct;
  const overPct =
    after && after.minor > limit.minor ? ((after.minor - limit.minor) / total) * 100 : 0;
  const scale = overPct > 0 ? limit.minor / total : 1;
  const tone = afterPct >= 75 ? "ask" : "";
  const left = Math.max(0, limit.minor - used.minor);
  return (
    <div className="meter">
      <div
        className="bar"
        role="img"
        aria-label={`${formatMoney(used)} of ${formatMoney(limit)} used`}
      >
        <div
          className={`fill ${tone}`}
          style={{ width: `${(drain ? 100 - usedPct : afterPct) * scale}%` }}
        />
        {overPct > 0 && <div className="overflow" style={{ width: `${overPct}%` }} />}
      </div>
      <div className="labels">
        <span>
          {drain
            ? `${formatMoney({ minor: left, currency: limit.currency })} left`
            : `${formatMoney(used)} of ${formatMoney(limit)}`}
        </span>
        <span>{resetsAt ? `resets ${shortDate(resetsAt)}` : drain ? "ends when used" : ""}</span>
      </div>
    </div>
  );
}

function ProductCard({
  p,
  chosen,
  onChoose,
  disabled,
}: {
  p: ProductView;
  chosen: boolean;
  onChoose: (variant: string) => void;
  disabled: boolean;
}) {
  const [variant, setVariant] = useState(
    p.variants.find((v) => v.includes("9")) ?? (p.variants[0] as string),
  );
  return (
    <div className={`card product ${chosen ? "chosen" : ""}`}>
      <div className="art">
        <ProductArt art={p.art} color={p.color} />
      </div>
      <div className="info">
        <span className="name">{p.name}</span>
        <span className="store">{p.store}</span>
        <span className="price num">{formatMoney(p.price)}</span>
        <span className="meta">{p.delivery}</span>
        <span className="meta">Returns: {p.returns}</span>
        {p.variants.length > 1 && (
          <select
            aria-label={`Size for ${p.name}`}
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
          >
            {p.variants.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={`btn ${chosen ? "" : "primary"}`}
          disabled={disabled}
          onClick={() => onChoose(variant)}
        >
          {chosen ? "Chosen" : "Choose"}
        </button>
      </div>
    </div>
  );
}

function Message({
  m,
  session,
  state,
  onWhy,
  onOpenApproval,
}: {
  m: ChatMessage;
  session: Session;
  state: EngineState;
  onWhy: (recordId: string) => void;
  onOpenApproval: () => void;
}) {
  const [chosen, setChosen] = useState<string>();
  switch (m.type) {
    case "text":
      return m.role === "user" ? (
        <div className="msg user">
          <div className="bubble">{m.text}</div>
        </div>
      ) : (
        <div className="msg agent-row">
          <div className="avatar" aria-hidden="true">
            e
          </div>
          <div className={`agent-text body ${m.streaming ? "streaming" : ""}`}>{m.text}</div>
        </div>
      );
    case "products":
      return (
        <div className="msg indent">
          <section className="carousel" aria-label="Products">
            {m.items.map((p) => (
              <ProductCard
                key={p.id}
                p={p}
                chosen={chosen === p.id}
                disabled={state.working || state.stopped || Boolean(chosen)}
                onChoose={(variant) => {
                  setChosen(p.id);
                  void session.choose(p.id, variant, `${p.name}, ${variant.split(",")[0]}`);
                }}
              />
            ))}
          </section>
        </div>
      );
    case "comparison":
      return (
        <div className="msg indent">
          <div className="card card-pad">
            <div className="table-scroll">
              <table className="compare">
                <thead>
                  <tr>
                    <th />
                    {m.columns.map((c) => (
                      <th key={c.id} className={c.best ? "best" : ""}>
                        {c.party}
                        <small>{c.title}</small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {m.rows.map((r) => (
                    <tr key={r.label}>
                      <td className="muted">{r.label}</td>
                      {r.values.map((v, i) => (
                        <td
                          key={m.columns[i]?.id}
                          className={`num ${m.columns[i]?.best ? "best" : ""}`}
                        >
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {m.columns.find((c) => c.best) && (
              <div className="footnote">
                <span className="tag go">Best match</span> {m.columns.find((c) => c.best)?.party}:{" "}
                {m.columns.find((c) => c.best)?.best}
              </div>
            )}
            {m.footnote && <div className="footnote">{m.footnote}</div>}
            <div className="chips">
              {m.columns.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="chip"
                  disabled={state.working}
                  onClick={() => void session.send(`Go with ${c.party}`)}
                >
                  Go with {c.party}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    case "offer":
      return (
        <div className="msg indent">
          <div className="card card-pad">
            <div className="offer-head">
              <strong>{m.party}</strong>
              <span className={`tag ${m.binding ? "ask" : ""}`}>
                {m.binding ? "Binding if accepted" : "Not binding"}
              </span>
            </div>
            <div className="offer-figure">{m.headline.replace("Decision in principle: ", "")}</div>
            <div className="muted" style={{ fontSize: 13, marginTop: -8, marginBottom: 12 }}>
              Decision in principle
            </div>
            <dl className="facts">
              {m.rows.map((r) => (
                <FactRow key={r.label} label={r.label} value={r.value} />
              ))}
            </dl>
            <div className="authority">
              <Seal size={16} /> {m.sourceLine}
              <span className="links">
                <button type="button" className="link-btn" onClick={() => onWhy(m.recordId)}>
                  Record
                </button>
              </span>
            </div>
          </div>
        </div>
      );
    case "receipt":
      return (
        <div className="msg indent">
          <div className="card card-pad">
            <div className="receipt-head">
              <strong>{m.store}</strong>
              <span className="muted num" style={{ fontSize: 13 }}>
                Order {m.orderRef}
              </span>
            </div>
            <dl className="facts">
              {m.items.map((i) => (
                <FactRow key={i.name} label={i.name} value={formatMoney(i.price)} />
              ))}
              <dt className="total">Total</dt>
              <dd className="total">{formatMoney(m.total)}</dd>
            </dl>
            <div className="authority">
              <Icon name="check" size={16} /> {m.authority}
              <span className="links">
                <button type="button" className="link-btn" onClick={() => onWhy(m.recordId)}>
                  Why
                </button>
                <button type="button" className="link-btn" onClick={() => onWhy(m.recordId)}>
                  Record
                </button>
              </span>
            </div>
          </div>
        </div>
      );
    case "limit-chip":
      return (
        <div className="msg indent">
          <span className={`limit-chip ${m.tone}`}>
            <Icon name="check" size={15} />
            <span>
              {m.label}:{" "}
              <span className="num">
                {formatMoney(m.used)} of {formatMoney(m.limit)}
              </span>{" "}
              used
              {m.tone === "ask" &&
                `, ${formatMoney({ minor: m.limit.minor - m.used.minor, currency: m.limit.currency })} left`}
            </span>
          </span>
        </div>
      );
    case "progress": {
      const done = m.steps.filter((s) => s.state === "done").length;
      return (
        <div className="msg indent">
          <div className="card card-pad progress">
            <div className="head">
              <span>{m.title}</span>
              <span className="muted num" style={{ fontWeight: 400, fontSize: 13 }}>
                {done} of {m.steps.length} done
              </span>
            </div>
            <ul className="steps">
              {m.steps.map((s) => (
                <li key={s.id} className={s.state}>
                  <span className="state-dot" aria-hidden="true">
                    {s.state === "done" ? (
                      <Icon name="check" size={12} />
                    ) : s.state === "asked" ? (
                      "?"
                    ) : s.state === "stopped" ? (
                      "✕"
                    ) : null}
                  </span>
                  <span>
                    {s.label}
                    {s.state === "asked" ? ": needs you" : ""}
                  </span>
                  {s.party && <span className="party-chip">{s.party}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    }
    case "approval": {
      const pending = m.state === "pending" && state.pending?.request.id === m.requestId;
      const words: Record<string, string> = {
        "approved-once": "You approved this",
        "standing-set": "Covered by your new limit",
        denied: "You said no",
        expired: "Expired",
        cancelled: "Cancelled by stop",
        pending: "Waiting for you",
      };
      return (
        <div className="msg indent">
          <button
            type="button"
            className={`stub ${pending ? "" : "resolved"}`}
            onClick={pending ? onOpenApproval : undefined}
            disabled={!pending}
          >
            <Icon name={pending ? "shield" : "check"} size={16} />
            {words[m.state]}: {m.summary}
            {m.resolvedAt && !pending
              ? ` · ${new Date(m.resolvedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : ""}
          </button>
        </div>
      );
    }
    case "blocked":
      return (
        <div className="msg indent">
          <div className="card card-pad blocked">
            <div className="bt">
              <Icon name="shield" /> {m.title}
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 15 }}>{m.source} contained this text:</p>
            {m.quoted && <blockquote>“{m.quoted}”</blockquote>}
            <p style={{ margin: 0, fontSize: 15 }}>
              Text on a web page can inform me. It cannot instruct me. {m.notDone}
            </p>
            <div className="authority">
              Outcome: stop
              <span className="links">
                <button type="button" className="link-btn" onClick={() => onWhy(m.recordId)}>
                  Why
                </button>
                <button type="button" className="link-btn" onClick={() => onWhy(m.recordId)}>
                  Record
                </button>
              </span>
            </div>
          </div>
        </div>
      );
    case "rule-change": {
      const live = m.change !== "revoked" && m.undoUntil && Date.parse(m.undoUntil) > Date.now();
      const active = state.rules.some((r) => r.rule.id === m.rule.id);
      return (
        <div className="msg indent">
          <div className={`rule-change ${m.change === "revoked" ? "revoked" : ""}`}>
            <Icon name={m.change === "revoked" ? "x" : "check"} size={16} />
            <span>{m.summary}</span>
            {live && active && (
              <button
                type="button"
                className="link-btn"
                onClick={() => void session.engine.revokeRule(m.rule.id, state.activeChat)}
              >
                Undo
              </button>
            )}
          </div>
        </div>
      );
    }
    case "sign-in":
      return (
        <div className="msg indent muted" style={{ fontSize: 14 }}>
          Signed in to {m.site} as {m.account} using {m.method}.
        </div>
      );
    case "stopped":
      return <div className="msg stopped-note">Stopped. {AGENT_NAME} took no further action.</div>;
  }
}

export function FactRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: string;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={emphasis ?? (label === "Total" ? "total" : "")}>{value}</dd>
    </>
  );
}

export function Composer({ session, state }: { session: Session; state: EngineState }) {
  const [text, setText] = useState("");
  const send = () => {
    if (!text.trim() || state.stopped) return;
    void session.send(text);
    setText("");
  };
  return (
    <div className="composer-wrap">
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label className="sr-only" htmlFor="composer">
          Message {AGENT_NAME}
        </label>
        <textarea
          id="composer"
          rows={1}
          value={text}
          placeholder={
            state.stopped
              ? `${AGENT_NAME} is stopped`
              : `Ask ${AGENT_NAME} to find, buy, book or apply`
          }
          disabled={state.stopped}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="submit"
          className="send"
          aria-label="Send"
          disabled={!text.trim() || state.stopped}
        >
          <Icon name="send" />
        </button>
      </form>
      <div className="core-toggle">
        {state.core === "live" ? "Live model" : "Built-in demo"} · every action passes the gate
        {state.liveAvailable && (
          <button
            type="button"
            onClick={() => session.engine.setCore(state.core === "live" ? "scripted" : "live")}
          >
            {state.core === "live" ? "Use built-in demo" : "Use live model"}
          </button>
        )}
      </div>
    </div>
  );
}

export function Conversation({
  session,
  state,
  onWhy,
  onOpenApproval,
}: {
  session: Session;
  state: EngineState;
  onWhy: (recordId: string) => void;
  onOpenApproval: () => void;
}) {
  const chat = state.chats.find((c) => c.id === state.activeChat);
  const scroller = useRef<HTMLDivElement>(null);
  const count = chat?.messages.length ?? 0;
  const lastText = chat?.messages.at(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when messages change
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [count, lastText]);
  if (!chat || chat.messages.length === 0)
    return (
      <div className="scroll" ref={scroller}>
        <div className="column home">
          <h1>What should I take care of, {PRINCIPAL.name}?</h1>
          <p className="sub">
            It shops, applies and signs in on your behalf. It asks before anything you have not
            already allowed.
          </p>
          <div className="chips">
            {STARTERS.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => void session.send(s)}>
                {s}
              </button>
            ))}
          </div>
          {state.pending && (
            <button type="button" className="needs-you" onClick={onOpenApproval}>
              <Icon name="shield" /> Needs you: {state.pending.request.title}
            </button>
          )}
          <div className="seal-line">
            <Seal /> {AGENT_NAME} is an Answerable agent: it answers to you for everything it does.
          </div>
        </div>
      </div>
    );
  return (
    <div className="scroll" ref={scroller}>
      <div className="column">
        {chat.messages.map((m) => (
          <Message
            key={m.id}
            m={m}
            session={session}
            state={state}
            onWhy={onWhy}
            onOpenApproval={onOpenApproval}
          />
        ))}
      </div>
    </div>
  );
}
