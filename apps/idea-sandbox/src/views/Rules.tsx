// AUTHORED-BY Claude Opus 5.5
import { describeMandate, describePolicy } from "@jeswr/agent-sandbox";
import {
  CUSTOMERS,
  customerPolicy,
  DEFAULT_SETTINGS,
  DIRECTORY,
  PRICE_LIST_POLICY,
  SHIPMENTS_POLICY,
  SICKNESS_POLICY,
  supportMandate,
  transactionsPolicy,
} from "@jeswr/agent-sandbox/world";
import { type OdrlPolicy, policyToTurtle } from "@jeswr/solid-odrl";
import { useEffect, useState } from "react";
import type { Shared } from "../App.js";
import { Json, Section, Toggle } from "../components.js";

const maria = CUSTOMERS[0];
const DATA_RULES: readonly { title: string; who: string; policy: OdrlPolicy }[] = maria
  ? [
      {
        title: "A customer's record",
        who: "Attached by Harbour & Finch to each customer's record",
        policy: customerPolicy(maria),
      },
      {
        title: "Card transactions",
        who: "Attached to each customer's transactions",
        policy: transactionsPolicy(maria),
      },
      {
        title: "A sickness note",
        who: "Attached by HR to health records",
        policy: SICKNESS_POLICY,
      },
      {
        title: "Northwind's shipment schedule",
        who: "Attached by Northwind Logistics, a partner",
        policy: SHIPMENTS_POLICY,
      },
      { title: "The public price list", who: "Attached by marketing", policy: PRICE_LIST_POLICY },
    ]
  : [];

export function Rules({ shared }: { shared: Shared }) {
  const { settings, setSettings } = shared;
  const mandate = supportMandate(settings);
  const text = describeMandate(mandate, DIRECTORY);
  const set = <K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) =>
    setSettings({ ...settings, [key]: value });
  return (
    <div className="page">
      <Section
        title="The agent's rules"
        intro="These are the global rules for Finch Assist, the support agent. They are an ODRL policy (an agent mandate). The sentences below are generated from the same policy the gate enforces, so what you read is what runs."
      >
        <div className="columns">
          <div className="card col-permit">
            <h3>On its own</h3>
            <ul className="plain">
              {text.onItsOwn.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
          <div className="card col-review">
            <h3>Only with a person's approval</h3>
            <ul className="plain">
              {text.withApproval.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <p className="hint">Anything not listed anywhere is refused.</p>
          </div>
          <div className="card col-stop">
            <h3>Never</h3>
            <ul className="plain">
              {text.never.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="card">
          <h3>Limits</h3>
          <ul className="plain">
            {text.limits.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      </Section>

      <Section
        title="Change the rules"
        intro="Changes apply straight away, including to a story you are part-way through."
      >
        <div className="card settings">
          <Range
            label="Messages a day, in total"
            value={settings.sendsPerDay}
            min={0}
            max={20}
            onChange={(v) => set("sendsPerDay", v)}
          />
          <Range
            label="Messages to any one person, per 24 hours"
            value={settings.perRecipientPerDay}
            min={0}
            max={5}
            onChange={(v) => set("perRecipientPerDay", v)}
          />
          <Range
            label="Refunds a day before a person must approve (£)"
            value={settings.refundsPerDay}
            min={0}
            max={1000}
            step={50}
            onChange={(v) => set("refundsPerDay", v)}
          />
          <Toggle
            checked={settings.customerEmailsNeedApproval}
            onChange={(v) => set("customerEmailsNeedApproval", v)}
            label="Every email to a customer needs approval"
          />
          <Toggle
            checked={settings.hrAccess}
            onChange={(v) => set("hrAccess", v)}
            label="The agent may read the HR system"
          />
          <Toggle
            checked={settings.analyticsAccess}
            onChange={(v) => set("analyticsAccess", v)}
            label="The agent may use InsightPro AI (an outside service)"
          />
          <button type="button" onClick={() => setSettings(DEFAULT_SETTINGS)}>
            Reset to the defaults
          </button>
        </div>
        <details className="card">
          <summary>Show the policy as data</summary>
          <Json value={mandate} max={4000} />
        </details>
      </Section>

      <Section
        title="Rules attached to the data"
        intro="Each record carries its owner's rules. The agent cannot read a record its rules forbid, and once it has read one, those rules apply to every message or upload it sends to a person or outside service afterwards."
      >
        <div className="grid">
          {DATA_RULES.map((d) => (
            <DataRule key={d.title} {...d} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function DataRule({ title, who, policy }: { title: string; who: string; policy: OdrlPolicy }) {
  const [turtle, setTurtle] = useState<string>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || turtle) return;
    policyToTurtle(policy).then(setTurtle, (e: Error) =>
      setTurtle(`Could not render: ${e.message}`),
    );
  }, [open, turtle, policy]);
  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="hint">{who}</p>
      <ul className="plain">
        {describePolicy(policy, DIRECTORY).map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>Show the ODRL</summary>
        <pre className="turtle">{turtle ?? "Loading…"}</pre>
      </details>
    </div>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="range">
      <span>
        {label}: <strong>{value}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
