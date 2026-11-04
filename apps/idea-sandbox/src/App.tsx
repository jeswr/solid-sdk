// AUTHORED-BY Claude Opus 5.5
import { type EnforcementMode, type JudgeModel, standInJudge } from "@jeswr/agent-sandbox";
import {
  DEFAULT_SETTINGS,
  scenario as findScenario,
  type RuleSettings,
  SCENARIOS,
} from "@jeswr/agent-sandbox/world";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { claudeJudge, loadKey, saveKey } from "./claude.js";
import { Session } from "./session.js";
import { CodeBox } from "./views/CodeBox.js";
import { Compare } from "./views/Compare.js";
import { Record } from "./views/Record.js";
import { Rules } from "./views/Rules.js";
import { Stories } from "./views/Stories.js";
import { Systems } from "./views/Systems.js";

export const MODES: readonly { id: EnforcementMode; label: string; detail: string }[] = [
  {
    id: "off",
    label: "No guardrails",
    detail: "Everything goes ahead. The page still shows what the rules would have said.",
  },
  {
    id: "policy",
    label: "Rules as code",
    detail: "Written rules decide every action, the same way every time.",
  },
  { id: "llm", label: "AI judge", detail: "An AI model reads the rules and decides each action." },
  {
    id: "hybrid",
    label: "Rules + AI",
    detail: "An AI model says what a message is for; the written rules decide.",
  },
];

const TABS = [
  { id: "stories", label: "Stories" },
  { id: "rules", label: "Rules" },
  { id: "systems", label: "Connected systems" },
  { id: "code", label: "Code box" },
  { id: "compare", label: "Compare" },
  { id: "record", label: "Audit log" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** What every view shares. */
export interface Shared {
  readonly settings: RuleSettings;
  setSettings(next: RuleSettings): void;
  readonly mode: EnforcementMode;
  setMode(mode: EnforcementMode): void;
  readonly storyId: string;
  setStoryId(id: string): void;
  readonly apiKey: string;
  setApiKey(key: string): void;
  /** Claude when a key is set, else the labelled keyword stand-in. */
  readonly judge: JudgeModel;
  readonly judgeIsModel: boolean;
  /** The live play-through of the chosen story. It outlives tab changes. */
  readonly session: Session;
  /** Start the chosen story again from the beginning. */
  restart(): void;
}

/**
 * The live session for the chosen story, held above the tabs so leaving Stories keeps its
 * progress. A new one starts only when the story changes or on restart; rules, mode and judge
 * changes apply to the running one.
 */
function useSession(
  storyId: string,
  mode: EnforcementMode,
  settings: RuleSettings,
  judge: JudgeModel,
) {
  const [generation, setGeneration] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new session starts only on story change or restart.
  const session = useMemo(
    () => new Session(findScenario(storyId), mode, settings, judge),
    [storyId, generation],
  );
  useEffect(() => session.world.setSettings(settings), [session, settings]);
  useEffect(() => session.sandbox.setMode(mode), [session, mode]);
  useEffect(() => session.sandbox.setJudge(judge), [session, judge]);
  useSyncExternalStore(
    (l) => session.subscribe(l),
    () =>
      `${session.items.length}:${session.position}:${session.busy}:${session.items.filter((i) => i.kind === "call" && i.settled).length}`,
  );
  return { session, restart: () => setGeneration((g) => g + 1) };
}

function initialTab(): Tab {
  const hash = location.hash.slice(1);
  return (TABS.find((t) => t.id === hash)?.id ?? "stories") as Tab;
}

export function App() {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [settings, setSettings] = useState<RuleSettings>(DEFAULT_SETTINGS);
  const [mode, setMode] = useState<EnforcementMode>("policy");
  const [storyId, setStoryId] = useState<string>(SCENARIOS[0]?.id ?? "");
  const [apiKey, setKey] = useState(loadKey);
  const judge = useMemo(() => (apiKey ? claudeJudge(apiKey) : standInJudge), [apiKey]);
  const { session, restart } = useSession(storyId, mode, settings, judge);

  useEffect(() => {
    const onHash = () => setTab(initialTab());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  const shared: Shared = {
    settings,
    setSettings,
    mode,
    setMode,
    storyId,
    setStoryId,
    apiKey,
    setApiKey(key) {
      saveKey(key);
      setKey(key);
    },
    judge,
    judgeIsModel: Boolean(apiKey),
    session,
    restart,
  };

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ◈
          </span>
          <div>
            <h1>Agent Sandbox</h1>
            <p>
              Policy as code for AI agents. Harbour &amp; Finch is a <strong>fictional</strong>{" "}
              company with made-up records; every decision on this page is made by real policy code.
            </p>
          </div>
        </div>
        <nav aria-label="Sections">
          {TABS.map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </a>
          ))}
        </nav>
      </header>
      <main>
        {tab === "stories" && <Stories shared={shared} />}
        {tab === "rules" && <Rules shared={shared} />}
        {tab === "systems" && <Systems shared={shared} />}
        {tab === "code" && <CodeBox shared={shared} />}
        {tab === "compare" && <Compare shared={shared} />}
        {tab === "record" && <Record shared={shared} />}
      </main>
      <footer>
        Built for the ODI IDEA programme as part of the Solid App Suite. Rules are ODRL 2.2
        policies, evaluated by <code>@jeswr/agent-sandbox</code>, <code>@jeswr/agent-mandate</code>{" "}
        and <code>@jeswr/solid-odrl</code>.
      </footer>
    </div>
  );
}

export function ModePicker({ shared, compact = false }: { shared: Shared; compact?: boolean }) {
  return (
    <fieldset className={`modes${compact ? " compact" : ""}`}>
      <legend>Who decides?</legend>
      {MODES.map((m) => (
        <label key={m.id} className={shared.mode === m.id ? "mode active" : "mode"}>
          <input
            type="radio"
            name="mode"
            checked={shared.mode === m.id}
            onChange={() => shared.setMode(m.id)}
          />
          <span className="mode-label">{m.label}</span>
          {!compact && <span className="hint">{m.detail}</span>}
        </label>
      ))}
      {(shared.mode === "llm" || shared.mode === "hybrid") && !shared.judgeIsModel && (
        <p className="warning">
          No model is connected, so a simple keyword check stands in for the AI. It is not a model.
          Add your own Claude API key under "Live AI" in Stories for a real comparison.
        </p>
      )}
    </fieldset>
  );
}
