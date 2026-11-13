// AUTHORED-BY Claude Opus 5.5
import { formatMoney, shortDate } from "@jeswr/agent-consent";
import { useState } from "react";
import type { Session } from "../engine/session.js";
import type { ActivityEntry, EngineState } from "../engine/types.js";
import {
  AGENT_NAME,
  FIXED_RULES,
  PERSONAS,
  SHARING_RULES,
  SIGN_INS,
  STORES,
} from "../engine/world.js";
import { HoldToConfirm } from "./approval.js";
import { Icon, Seal } from "./art.js";
import { CheckList, Meter } from "./chat.js";

const EXPLORER = "https://claude.ai/artifact/CeeevpC9wCwDyzcGDMrpPw";

export function CanDo({
  session,
  state,
  onStop,
}: {
  session: Session;
  state: EngineState;
  onStop: () => void;
}) {
  const [confirming, setConfirming] = useState<string>();
  return (
    <div className="scroll">
      <div className="column screen">
        <h1>What {AGENT_NAME} can do</h1>
        <p className="lead">
          Everything it may do without asking you is on this page. Each rule was signed on your
          device.
        </p>
        <h2>Spending</h2>
        {state.rules.length === 0 && (
          <div className="card card-pad muted" style={{ fontSize: 15 }}>
            No spending limits yet, so {AGENT_NAME} asks before every purchase. You can set one from
            any purchase.
          </div>
        )}
        {state.rules.map((r) => (
          <div key={r.rule.id} className="card allowance">
            <div className="top">
              <p>{r.summary}</p>
            </div>
            {r.rule.kind !== "per-purchase" && (
              <Meter
                used={r.used}
                limit={r.rule.limit}
                resetsAt={r.resetsAt}
                drain={r.rule.kind === "allowance"}
              />
            )}
            <div className="row">
              <span className="tag go">
                {r.rule.scope.kind === "merchant"
                  ? r.rule.scope.label
                  : r.rule.scope.kind === "category"
                    ? r.rule.scope.label
                    : "Any store"}
              </span>
              <span className="grow muted" style={{ fontSize: 12 }}>
                {r.rule.expiresAt
                  ? `Ends ${shortDate(r.rule.expiresAt)}`
                  : r.rule.kind === "allowance"
                    ? "Ends when used up"
                    : "Until you turn it off"}
              </span>
              {confirming === r.rule.id ? (
                <div style={{ width: 180 }}>
                  <HoldToConfirm
                    label="Hold to turn off"
                    primary={false}
                    onConfirm={() => {
                      setConfirming(undefined);
                      void session.engine.revokeRule(r.rule.id);
                    }}
                  />
                </div>
              ) : (
                <button type="button" className="btn text" onClick={() => setConfirming(r.rule.id)}>
                  Turn off
                </button>
              )}
            </div>
          </div>
        ))}
        <h2>Sharing</h2>
        <div className="card list">
          {SHARING_RULES.map((s) => (
            <div key={s.kind} className="item">
              <div className="grow">
                <div>{s.kind}</div>
                <div className="sub">{s.value}</div>
              </div>
            </div>
          ))}
        </div>
        <h2>Trusted stores and organizations</h2>
        <div className="card list">
          {STORES.map((s) => (
            <div key={s.id} className="item">
              <Icon name="store" />
              <div className="grow">
                <div>{s.name}</div>
                <div className="sub">
                  {s.established === "own-list"
                    ? "On your list"
                    : s.established === "register"
                      ? "Found through the registered merchants list"
                      : "Not confirmed: I ask before dealing with it"}
                </div>
              </div>
            </div>
          ))}
          <div className="item">
            <Icon name="bank" />
            <div className="grow">
              <div>North Bank, Canal Bank, Mill Street Bank</div>
              <div className="sub">Found through the sector register of mortgage lenders</div>
            </div>
          </div>
        </div>
        <h2>Always ask, never do</h2>
        <div className="card list">
          {FIXED_RULES.map((f) => (
            <div key={f.text} className="item">
              <div className="grow">{f.text}</div>
              <span className={`tag ${f.value === "Never" ? "stop" : "ask"}`}>{f.value}</span>
            </div>
          ))}
        </div>
        <h2>Stop everything</h2>
        <div className="card card-pad">
          <p style={{ margin: "0 0 12px", fontSize: 15 }}>
            Stop {AGENT_NAME} at once. Nothing runs until you resume. Open requests are cancelled.
          </p>
          <button
            type="button"
            className="btn"
            style={{ color: "var(--stop)", borderColor: "var(--stop)" }}
            onClick={onStop}
            disabled={state.stopped}
          >
            {state.stopped ? "Stopped" : `Stop ${AGENT_NAME}`}
          </button>
        </div>
        <p className="about">
          About: this is a demo of an Answerable agent. The stores, banks and people are fictional
          and both sides of every exchange run this code. Approvals and spending rules are signed
          with a key created on this device (
          {state.deviceKid ? `key ${state.deviceKid.slice(0, 12)}…` : "creating"}); the gate
          verifies the signature every time it relies on one. Reloading the page starts over.
        </p>
      </div>
    </div>
  );
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "purchases", label: "Purchases" },
  { id: "shared", label: "Shared data" },
  { id: "asked", label: "Asked you" },
  { id: "blocked", label: "Blocked" },
] as const;

function time(at: string): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function ActivityDetail({ entry, onBack }: { entry: ActivityEntry; onBack: () => void }) {
  return (
    <div className="scroll">
      <div className="column screen">
        <button type="button" className="btn text" onClick={onBack} style={{ marginLeft: -12 }}>
          ← Activity
        </button>
        <h1 style={{ marginTop: 8 }}>{entry.summary}</h1>
        <p className="lead">
          <span className={`tag ${entry.outcome}`}>
            {entry.outcome === "ask" ? "Asked you" : entry.outcome === "go" ? "Done" : "Stopped"}
          </span>{" "}
          {entry.detail && <span className="num">{entry.detail} · </span>}
          {time(entry.at)}
        </p>
        {entry.authority && (
          <div
            className="card card-pad"
            style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 15 }}
          >
            <Seal /> {entry.authority}
          </div>
        )}
        {entry.checks.length > 0 && (
          <>
            <h2>Why: the outbound gate</h2>
            <div className="card card-pad">
              <CheckList checks={entry.checks} />
            </div>
          </>
        )}
        {entry.inbound && entry.inbound.length > 0 && (
          <>
            <h2>What came back: the inbound gate</h2>
            <div className="card card-pad">
              <CheckList checks={entry.inbound} />
            </div>
          </>
        )}
        <h2>Record</h2>
        <div
          className="card card-pad"
          style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}
        >
          <div>
            Record id <span className="num">{entry.id}</span>
          </div>
          {entry.digest && (
            <div>
              Action digest
              <div className="record">{entry.digest}</div>
            </div>
          )}
          {entry.consentJws && (
            <div>
              Your signed consent (compact JWS, ES256, device key)
              <div className="record">{entry.consentJws}</div>
            </div>
          )}
          <div className="row">
            {entry.consentJws && (
              <button
                type="button"
                className="btn"
                onClick={() => void navigator.clipboard?.writeText(entry.consentJws ?? "")}
              >
                Copy proof
              </button>
            )}
            <a className="btn" href={EXPLORER} target="_blank" rel="noreferrer">
              Open the trace explorer <Icon name="external" size={14} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Activity({
  state,
  open,
  onOpen,
}: {
  state: EngineState;
  open?: string;
  onOpen: (id?: string) => void;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const entry = state.activity.find((a) => a.id === open);
  if (entry) return <ActivityDetail entry={entry} onBack={() => onOpen(undefined)} />;
  const rows = state.activity.filter((a) => filter === "all" || a.filter === filter);
  return (
    <div className="scroll">
      <div className="column screen">
        <h1>Activity</h1>
        <p className="lead">
          Everything {AGENT_NAME} did, asked or refused, with the reason and the record.
        </p>
        <fieldset className="filters" aria-label="Filter">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </fieldset>
        <div className="card list">
          {rows.length === 0 && <div className="item muted">Nothing here yet.</div>}
          {rows.map((a) => (
            <button key={a.id} type="button" className="item act-row" onClick={() => onOpen(a.id)}>
              <span className={`oglyph ${a.outcome}`}>
                <Icon
                  name={a.outcome === "go" ? "check" : a.outcome === "ask" ? "shield" : "x"}
                  size={16}
                />
              </span>
              <span className="grow">
                <span style={{ display: "block" }}>{a.summary}</span>
                {a.detail && <span className="sub num">{a.detail}</span>}
              </span>
              <span className="time">{time(a.at)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Accounts() {
  const sites = [...new Set(SIGN_INS.map((s) => s.site))];
  return (
    <div className="scroll">
      <div className="column screen">
        <h1>Accounts and sign-ins</h1>
        <p className="lead">
          Who you are on each site, and how {AGENT_NAME} signs in for you. Passwords are never shown
          to the AI model.
        </p>
        <div className="placeholder-note">
          Preview: the sign-in connector (saved sign-ins, passkeys, single sign-on and your password
          manager) is being built separately. These rows are examples.
        </div>
        <h2>Personas</h2>
        <div className="card list">
          {PERSONAS.map((p, i) => (
            <div key={p.id} className="item">
              <Icon name="user" />
              <div className="grow">
                <div>{p.name}</div>
                <div className="sub">{p.detail}</div>
              </div>
              {i === 0 && <span className="tag go">In use</span>}
            </div>
          ))}
        </div>
        <h2>Sign-ins</h2>
        {sites.map((site) => (
          <div key={site} className="card list" style={{ marginBottom: 10 }}>
            {SIGN_INS.filter((s) => s.site === site).map((s, i) => (
              <div key={s.account} className="item">
                <Icon name={i === 0 ? "key" : "user"} />
                <div className="grow">
                  <div>
                    {i === 0 ? site : ""}{" "}
                    {i === 0 ? (
                      <span className="muted">· {s.account}</span>
                    ) : (
                      <span className="muted">{s.account}</span>
                    )}
                  </div>
                  <div className="sub">
                    {s.method} · {s.source} · last used {s.lastUsed}
                  </div>
                </div>
                <span className={`tag ${s.keep ? "go" : ""}`}>
                  {s.keep ? "Kept signed in" : "Ask each time"}
                </span>
              </div>
            ))}
          </div>
        ))}
        <h2>Password manager</h2>
        <div className="card list">
          <div className="item">
            <Icon name="lock" />
            <div className="grow">
              <div>Connect your password manager</div>
              <div className="sub">
                Find saved sign-ins, ask before using one, and save new ones back.
              </div>
            </div>
            <span className="tag">Coming soon</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Glance({
  state,
  onOpenActivity,
}: {
  state: EngineState;
  onOpenActivity: (id: string) => void;
}) {
  const receipts = state.activity.filter((a) => a.filter === "purchases").slice(0, 3);
  return (
    <aside className="glance" aria-label="At a glance">
      <section>
        <h3>Your limits</h3>
        {state.rules.length === 0 && (
          <div className="empty">None yet. {AGENT_NAME} asks before every purchase.</div>
        )}
        {state.rules.map((r) => (
          <div key={r.rule.id} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{r.label}</div>
            {r.rule.kind !== "per-purchase" && (
              <Meter
                used={r.used}
                limit={r.rule.limit}
                resetsAt={r.resetsAt}
                drain={r.rule.kind === "allowance"}
              />
            )}
          </div>
        ))}
      </section>
      <section>
        <h3>Recent purchases</h3>
        {receipts.length === 0 && <div className="empty">Nothing bought yet.</div>}
        {receipts.map((a) => (
          <button
            key={a.id}
            type="button"
            className="rail-item"
            onClick={() => onOpenActivity(a.id)}
          >
            <Icon name="check" size={16} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {a.summary.replace(/^Bought /, "")}
            </span>
            <span className="num muted" style={{ marginLeft: "auto" }}>
              {a.detail}
            </span>
          </button>
        ))}
      </section>
      <section>
        <h3>How this works</h3>
        <div className="empty" style={{ fontSize: 13, lineHeight: "19px" }}>
          The AI only proposes. Every purchase or share passes six checks: mandate, recipient,
          disclosure, data terms, limits and approval, evidence. Text from websites can inform it
          but never instruct it.
        </div>
      </section>
      <section>
        <h3>Spent with limits</h3>
        <div className="empty num">
          {formatMoney({
            minor: state.rules.reduce((s, r) => s + r.used.minor, 0),
            currency: "USD",
          })}{" "}
          this month
        </div>
      </section>
    </aside>
  );
}
