// AUTHORED-BY Claude Opus 5.5
// Describe a process in your own words (typed or spoken); Claude drafts an automation rule,
// shows its thinking, and the rule opens in a pop-up for review.
import { ruleTools } from "@jeswr/agent-sandbox";
import { ArrowUp, Bot, Check, Code2, Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type Automation,
  appName,
  claudeDraft,
  EXAMPLE_REQUESTS,
  standInDraft,
  whenText,
} from "../automations.js";
import { useAutomations } from "../context.js";
import { Icon } from "../icons.js";
import { revealIsInstant, Trace, type TraceItem } from "../trace.js";

/** The conversation, kept by the app so it survives visiting other pages. */
export interface ChatState {
  readonly items: readonly TraceItem[];
  readonly busy: boolean;
}

let ids = 0;
const nextId = () => `h${ids++}`;

/** What Claude "thought" while drafting, rebuilt from the rule it wrote. */
function draftThoughts(
  automation: Automation,
  tools: Parameters<typeof ruleTools>[1],
): TraceItem[] {
  const { rule } = automation;
  const own = ruleTools(rule, tools);
  const apps = [...new Set(own.map((t) => appName(t)))];
  const sends = rule.policy.allow.find((a) => a.to !== undefined);
  return [
    { kind: "thinking", id: nextId(), text: `When should this run? ${whenText(rule)}.` },
    {
      kind: "thinking",
      id: nextId(),
      text: `Fixed code or an AI model? ${rule.runner.kind === "code" ? "Code" : "A model"}. ${rule.rationale}`,
    },
    {
      kind: "thinking",
      id: nextId(),
      text: `It needs ${apps.join(" and ")}. I'll give it ${own.length === 1 ? "one tool" : `${own.length} tools`} and hide everything else.`,
    },
    {
      kind: "thinking",
      id: nextId(),
      text: `Now the policy. ${
        sends?.to === "sender"
          ? "It may only write back to whoever emailed."
          : sends?.to === "staff"
            ? "It may only message our own staff."
            : sends
              ? "It may only message the people named."
              : "It never sends messages."
      }${rule.policy.sendsPerDay ? ` At most ${rule.policy.sendsPerDay} a day.` : ""}${
        rule.policy.allow.some((a) => a.approval)
          ? " A person approves before anything goes out."
          : ""
      }`,
    },
  ];
}

export function Home({
  chat,
  setChat,
  apiKey,
}: {
  chat: ChatState;
  setChat(update: (c: ChatState) => ChatState): void;
  apiKey: string;
}) {
  const api = useAutomations();
  const end = useRef<HTMLDivElement>(null);
  const push = (...items: TraceItem[]) => setChat((c) => ({ ...c, items: [...c.items, ...items] }));
  const lastId = chat.items[chat.items.length - 1]?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a new item arrives.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [lastId]);

  async function submit(text: string) {
    if (!text.trim() || chat.busy) return;
    push({ kind: "user", id: nextId(), text });
    setChat((c) => ({ ...c, busy: true }));
    let draft: Awaited<ReturnType<typeof claudeDraft>>;
    try {
      draft = apiKey ? await claudeDraft(api.apps, apiKey, text) : standInDraft(text);
    } catch (e) {
      draft = { ok: false, message: `Claude could not draft the rule: ${(e as Error).message}` };
    }
    if (!draft.ok) {
      push({ kind: "say", id: nextId(), text: draft.message });
      setChat((c) => ({ ...c, busy: false }));
      return;
    }
    const automation = draft.automation;
    api.addDraft(automation);
    const thoughts = draftThoughts(automation, api.apps.world.tools);
    push(
      ...(draft.note
        ? [{ kind: "notice", id: nextId(), text: draft.note, tone: "info" } as const]
        : []),
      ...thoughts,
      {
        kind: "notice",
        id: nextId(),
        text: "Checked against Harbour & Finch's rules and the connected apps: no problems found.",
        tone: "grant",
      },
      { kind: "node", id: nextId(), node: <RuleCard id={automation.rule.id} /> },
    );
    setChat((c) => ({ ...c, busy: false }));
    // Open the pop-up once the thinking has played out.
    const wait = revealIsInstant() ? 0 : (thoughts.length + (draft.note ? 1 : 0)) * 910 + 1300;
    setTimeout(() => api.showSheet(automation.rule.id), wait);
  }

  const empty = chat.items.length === 0;
  return (
    <div className={empty ? "home empty" : "home"}>
      {empty ? (
        <div className="hello">
          <span className="hello-mark" aria-hidden="true">
            <Bot size={28} />
          </span>
          <h1>What should we automate, Priya?</h1>
          <p className="hint">
            You are Priya Shah, support lead at Harbour &amp; Finch, a <strong>fictional</strong>{" "}
            company. Describe a process in your own words. Claude turns it into a rule, and every
            action the rule takes is checked against policy.
          </p>
        </div>
      ) : (
        <div className="conversation" aria-live="polite">
          <Trace items={chat.items} busy={chat.busy} />
          <div ref={end} />
        </div>
      )}
      <div className="composer-wrap">
        <Composer busy={chat.busy} onSubmit={submit} />
        {empty && (
          <div className="suggestions">
            {EXAMPLE_REQUESTS.map((e) => (
              <button
                type="button"
                key={e.title}
                className="suggestion"
                onClick={() => submit(e.text)}
              >
                <Icon name={e.icon} size={16} />
                {e.title}
              </button>
            ))}
          </div>
        )}
        <p className="composer-note hint">
          {apiKey
            ? "Claude drafts each rule with your key. Nothing runs until you turn it on."
            : "No Claude key added, so built-in examples stand in for Claude. Add your key in Settings to describe anything."}
        </p>
      </div>
    </div>
  );
}

function RuleCard({ id }: { id: string }) {
  const api = useAutomations();
  const automation = api.find(id);
  if (!automation) return null;
  const { rule } = automation;
  const kept = api.automations.some((a) => a.rule.id === id);
  return (
    <div className="rule-card">
      <span className="rule-card-icon">
        <Icon name={rule.icon} size={20} />
      </span>
      <div className="rule-card-text">
        <strong>{rule.title}</strong>
        <span className="hint">{rule.summary}</span>
        <span className="rule-card-tags">
          <span className="tag">
            {rule.runner.kind === "code" ? (
              <Code2 size={13} aria-hidden="true" />
            ) : (
              <Bot size={13} aria-hidden="true" />
            )}
            {rule.runner.kind === "code" ? "Code" : "AI model"}
          </span>
          <span className="tag">{whenText(rule)}</span>
        </span>
      </div>
      {kept ? (
        <a className="button" href={`#automation/${encodeURIComponent(id)}`}>
          <Check size={15} aria-hidden="true" /> On · Try it
        </a>
      ) : (
        <button type="button" className="primary" onClick={() => api.showSheet(id)}>
          Review
        </button>
      )}
    </div>
  );
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

function speechRecognition(): (new () => SpeechRecognitionLike) | undefined {
  const w = globalThis as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | undefined;
}

function Composer({ busy, onSubmit }: { busy: boolean; onSubmit(text: string): void }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const before = useRef("");
  const Speech = speechRecognition();

  const send = () => {
    if (!text.trim() || busy) return;
    rec.current?.stop();
    onSubmit(text.trim());
    setText("");
  };

  const toggleMic = () => {
    if (!Speech) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Speech();
    r.lang = navigator.language || "en-GB";
    r.interimResults = true;
    r.continuous = true;
    before.current = text ? `${text.trim()} ` : "";
    r.onresult = (e) => {
      let heard = "";
      for (let i = 0; i < e.results.length; i++) heard += e.results[i]?.[0]?.transcript ?? "";
      setText(before.current + heard);
    };
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        aria-label="Describe a process to automate"
        placeholder="Describe a process to automate…"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="composer-actions">
        {Speech && (
          <button
            type="button"
            className={listening ? "icon-button listening" : "icon-button"}
            aria-label={listening ? "Stop dictating" : "Dictate"}
            aria-pressed={listening}
            onClick={toggleMic}
          >
            {listening ? (
              <MicOff size={18} aria-hidden="true" />
            ) : (
              <Mic size={18} aria-hidden="true" />
            )}
          </button>
        )}
        <button type="submit" className="send" aria-label="Send" disabled={busy || !text.trim()}>
          <ArrowUp size={18} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
