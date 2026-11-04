// AUTHORED-BY Claude Opus 5.5
// The "New automation rule" pop-up: what the rule does, how it runs, which systems it can
// reach, and the policies that apply, before anyone turns it on.
import { describeMandate } from "@jeswr/agent-sandbox";
import { APPS, AUTOMATION_PURPOSES, automationOrgMandate } from "@jeswr/agent-sandbox/world";
import {
  Ban,
  Bot,
  Building2,
  Clock,
  Code2,
  EyeOff,
  Hourglass,
  Mail,
  MousePointerClick,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type AppsSession,
  type Automation,
  policyLines,
  sampleMandate,
  whenText,
} from "../automations.js";
import { Json } from "../components.js";
import { Icon, SystemBadge } from "../icons.js";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "runs", label: "How it runs" },
  { id: "systems", label: "Systems" },
  { id: "policies", label: "Policies" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function RuleSheet({
  session,
  automation,
  isNew,
  onClose,
  onTurnOn,
}: {
  session: AppsSession;
  automation: Automation;
  isNew: boolean;
  onClose(): void;
  onTurnOn?(): void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    }
  }, []);
  const { rule } = automation;
  return (
    <dialog
      ref={dialog}
      className="sheet"
      aria-labelledby="sheet-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="sheet-head">
        <span className="sheet-icon">
          <Icon name={rule.icon} size={22} />
        </span>
        <div>
          <span className="eyebrow">{isNew ? "New automation rule" : "Automation rule"}</span>
          <h2 id="sheet-title">{rule.title}</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="sheet-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            type="button"
            role="tab"
            key={t.id}
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="sheet-body" role="tabpanel">
        {tab === "overview" && <Overview automation={automation} />}
        {tab === "runs" && <Runs automation={automation} />}
        {tab === "systems" && <Systems session={session} automation={automation} />}
        {tab === "policies" && <Policies session={session} automation={automation} />}
      </div>
      <footer className="sheet-foot">
        <span className="hint">Drafted by {automation.draftedBy}</span>
        {isNew && onTurnOn ? (
          <>
            <button type="button" onClick={onClose}>
              Not now
            </button>
            <button type="button" className="primary" onClick={onTurnOn}>
              <ShieldCheck size={16} aria-hidden="true" /> Turn on
            </button>
          </>
        ) : (
          <button type="button" onClick={onClose}>
            Done
          </button>
        )}
      </footer>
    </dialog>
  );
}

function TriggerIcon({ automation }: { automation: Automation }) {
  const k = automation.rule.trigger.kind;
  const I = k === "email" ? Mail : k === "schedule" ? Clock : MousePointerClick;
  return <I size={16} aria-hidden="true" />;
}

function Overview({ automation }: { automation: Automation }) {
  const { rule } = automation;
  return (
    <div className="facts">
      <p className="sheet-summary">{rule.summary}</p>
      <blockquote className="request">“{rule.request}”</blockquote>
      <dl>
        <div>
          <dt>
            <TriggerIcon automation={automation} /> When
          </dt>
          <dd>{whenText(rule)}</dd>
        </div>
        <div>
          <dt>
            {rule.runner.kind === "code" ? (
              <Code2 size={16} aria-hidden="true" />
            ) : (
              <Bot size={16} aria-hidden="true" />
            )}{" "}
            How
          </dt>
          <dd>
            {rule.runner.kind === "code"
              ? "Fixed code, the same steps every time."
              : "An AI model follows written instructions."}{" "}
            <span className="hint">{rule.rationale}</span>
          </dd>
        </div>
        <div>
          <dt>
            <ShieldCheck size={16} aria-hidden="true" /> Purpose
          </dt>
          <dd>{AUTOMATION_PURPOSES[rule.policy.purpose] ?? rule.policy.purpose}</dd>
        </div>
      </dl>
    </div>
  );
}

function Runs({ automation }: { automation: Automation }) {
  const { rule } = automation;
  return rule.runner.kind === "code" ? (
    <div>
      <p>
        This rule is plain code. It runs in a sealed JavaScript box with no network and no access to
        anything except the tools below, and every tool call goes through the policy check.
      </p>
      <pre className="code-view">
        <code>{rule.runner.source}</code>
      </pre>
    </div>
  ) : (
    <div>
      <p>
        Each time the rule runs, an AI model is given the email (or the time) and these standing
        instructions. It can only see the tools listed under Systems, and every call it makes goes
        through the policy check. Anything it reads, including instructions hidden in an email, is
        treated as data.
      </p>
      <blockquote className="instructions">{rule.runner.instructions}</blockquote>
    </div>
  );
}

function Systems({ session, automation }: { session: AppsSession; automation: Automation }) {
  const tools = session.world.tools;
  const allowed = new Set(automation.rule.policy.allow.map((a) => a.tool));
  return (
    <div className="sheet-systems">
      {APPS.map((app) => {
        const own = tools.filter((t) => t.system === app.system);
        const used = own.filter((t) => allowed.has(t.name));
        return (
          <section key={app.id} className={used.length ? "app-card" : "app-card unused"}>
            <div className="app-card-head">
              <SystemBadge system={app.system} />
              <span className="hint">{app.detail}</span>
            </div>
            <ul className="tool-list">
              {own.map((t) => (
                <li key={t.name} className={allowed.has(t.name) ? "on" : "off"}>
                  {allowed.has(t.name) ? (
                    <ShieldCheck size={14} aria-hidden="true" />
                  ) : (
                    <EyeOff size={14} aria-hidden="true" />
                  )}
                  <span>{t.title}</span>
                  <span className="hint">
                    {allowed.has(t.name) ? t.kind : "hidden from this rule"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Policies({ session, automation }: { session: AppsSession; automation: Automation }) {
  const [odrl, setOdrl] = useState(false);
  const { rule } = automation;
  const lines = policyLines(rule, session.world.tools);
  const org = describeMandate(automationOrgMandate(), session.world.directory);
  return (
    <div className="policies">
      <p className="hint">
        Two layers apply to every action. An action goes ahead only if both allow it, so this rule
        can narrow what the organisation allows but never widen it.
      </p>
      <section className="layer">
        <h3>
          <Icon name={rule.icon} size={16} /> This rule may
        </h3>
        <ul className="policy-lines">
          {lines.map((l) => (
            <li key={l.name}>
              {l.approval ? (
                <Hourglass size={15} aria-hidden="true" />
              ) : (
                <ShieldCheck size={15} aria-hidden="true" />
              )}
              <span>{l.text}</span>
            </li>
          ))}
          {rule.policy.sendsPerDay !== undefined && (
            <li>
              <Clock size={15} aria-hidden="true" />
              <span>Send at most {rule.policy.sendsPerDay} messages a day, then stop.</span>
            </li>
          )}
          <li>
            <Ban size={15} aria-hidden="true" />
            <span>Nothing else. Every other tool is hidden from it.</span>
          </li>
        </ul>
      </section>
      <section className="layer">
        <h3>
          <Building2 size={16} aria-hidden="true" /> Harbour &amp; Finch's rules for every
          automation
        </h3>
        <ul className="policy-lines">
          {org.never.map((t) => (
            <li key={t}>
              <Ban size={15} aria-hidden="true" />
              <span>{t}</span>
            </li>
          ))}
          {org.limits.map((t) => (
            <li key={t}>
              <Clock size={15} aria-hidden="true" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </section>
      <button type="button" className="text-button" onClick={() => setOdrl(!odrl)}>
        {odrl ? "Hide" : "Show"} this rule's policy as ODRL
      </button>
      {odrl && <Json value={sampleMandate(session, rule)} max={6000} />}
    </div>
  );
}
