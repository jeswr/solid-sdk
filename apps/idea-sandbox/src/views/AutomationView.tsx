// AUTHORED-BY Claude Opus 5.5
// One automation: try it on an email (or run it now), watch each action and its policy check,
// approve what is held, and see what changed in the apps.
import type { EnforcementMode, JudgeModel } from "@jeswr/agent-sandbox";
import { APP, type InboxEmail } from "@jeswr/agent-sandbox/world";
import { FileText, Inbox, Mail, Play, Send } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  type Automation,
  type AutomationRunView,
  emailEvent,
  runOnce,
  tryEmails,
  whenText,
} from "../automations.js";
import { AGENT_MODELS, claudeAgent } from "../claude.js";
import { Toggle } from "../components.js";
import { useAutomations } from "../context.js";
import { Icon, SystemBadge } from "../icons.js";
import { Trace, type TraceItem } from "../trace.js";

export function AutomationView({
  id,
  apiKey,
  mode,
  judge,
}: {
  id: string;
  apiKey: string;
  mode: EnforcementMode;
  judge: JudgeModel;
}) {
  const api = useAutomations();
  const automation = api.find(id);
  useSyncExternalStore(
    (l) => api.apps.subscribe(l),
    () => api.apps.version,
  );
  if (!automation)
    return (
      <div className="page-pad">
        <p>
          This automation doesn't exist any more. <a href="#home">Start a new one</a>.
        </p>
      </div>
    );
  const { rule } = automation;
  // Runs live in the session, keyed by automation, so they survive leaving this page.
  const runs = api.apps.runs(id);
  const busy = runs.some((r) => r.busy);

  async function start(label: string, event: Parameters<typeof runOnce>[2]) {
    const runId = api.apps.addRun(id, label);
    const update = (patch: Partial<AutomationRunView>) =>
      api.apps.updateRun(id, runId, () => patch);
    try {
      await runOnce(api.apps, automation as Automation, event, {
        ...(apiKey &&
          rule.runner.kind === "llm" && { model: claudeAgent(apiKey, AGENT_MODELS[1].id) }),
        mode,
        judge,
        onItems: (items) => update({ items }),
      });
    } catch (e) {
      const notice: TraceItem = {
        kind: "notice",
        id: `err${runId}`,
        text: (e as Error).message,
        tone: "error",
      };
      api.apps.updateRun(id, runId, (r) => ({ items: [...r.items, notice] }));
    } finally {
      update({ busy: false });
    }
  }

  const tryEmail = (email: InboxEmail) =>
    start(`${email.fromName}: ${email.subject}`, emailEvent(api.apps, email));

  return (
    <div className="automation">
      <header className="page-head">
        <span className="page-icon">
          <Icon name={rule.icon} size={22} />
        </span>
        <div className="page-title">
          <h1>{rule.title}</h1>
          <p className="hint">{rule.summary}</p>
        </div>
        <Toggle
          label={automation.on ? "On" : "Off"}
          checked={automation.on}
          onChange={(on) => api.setOn(id, on)}
        />
        <button type="button" onClick={() => api.showSheet(id)}>
          <FileText size={16} aria-hidden="true" /> Details
        </button>
      </header>

      <div className="automation-body">
        <div className="automation-main">
          <section className="try">
            <h2>
              <Play size={17} aria-hidden="true" /> Try it
            </h2>
            <p className="hint">
              {whenText(rule)}. Everything here is simulated: emails go to a pretend outbox.
            </p>
            {rule.trigger.kind === "email" ? (
              <ul className="emails">
                {tryEmails(api.apps, automation).map((m) => (
                  <li key={m.id}>
                    <Mail size={16} aria-hidden="true" />
                    <span className="email-from">{m.fromName}</span>
                    <span className="email-subject">{m.subject}</span>
                    <button
                      type="button"
                      className="small"
                      disabled={busy}
                      onClick={() => tryEmail(m)}
                      aria-label={`Run on ${m.fromName}: ${m.subject}`}
                    >
                      Run
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() =>
                  start(
                    "Run now",
                    rule.trigger.kind === "schedule"
                      ? { kind: "schedule", at: new Date(api.apps.clock()).toISOString() }
                      : { kind: "manual" },
                  )
                }
              >
                <Play size={15} aria-hidden="true" /> Run now
              </button>
            )}
          </section>
          {runs.map((r) => (
            <section key={r.id} className="run">
              <h3 className="run-title">
                <Inbox size={15} aria-hidden="true" /> {r.label}
              </h3>
              <Trace items={r.items} busy={r.busy} />
            </section>
          ))}
        </div>
        <AppsPanel />
      </div>
    </div>
  );
}

/** What the automations have done in the simulated apps. */
export function AppsPanel() {
  const { apps } = useAutomations();
  const s = apps.world.state;
  return (
    <aside className="apps-panel" aria-label="What happened in the apps">
      <h2>What happened</h2>
      <div className="panel-block">
        <SystemBadge system={APP.gmail} />
        {s.sent.length === 0 ? (
          <p className="hint">No emails sent yet.</p>
        ) : (
          <ul className="plain">
            {s.sent.map((m, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: an append-only list.
              <li key={i}>
                <Send size={13} aria-hidden="true" /> <strong>{m.to}</strong>: {m.subject}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="panel-block">
        <SystemBadge system={APP.jira} />
        <ul className="plain">
          {s.issues.map((i) => (
            <li key={i.key}>
              <strong>{i.key}</strong> {i.summary} <span className="hint">({i.status})</span>
            </li>
          ))}
        </ul>
      </div>
      {s.notes.length > 0 && (
        <div className="panel-block">
          <SystemBadge system={APP.hubspot} />
          <ul className="plain">
            {s.notes.map((n, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: an append-only list.
              <li key={i}>
                <strong>{n.contact}</strong>: {n.note}
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.slack.length > 0 && (
        <div className="panel-block">
          <SystemBadge system={APP.slack} />
          <ul className="plain">
            {s.slack.map((m, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: an append-only list.
              <li key={i}>{m.message}</li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
