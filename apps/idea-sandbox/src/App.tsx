// AUTHORED-BY Claude Opus 5.5
import { type EnforcementMode, type JudgeModel, standInJudge } from "@jeswr/agent-sandbox";
import {
  AUTOMATION_EXAMPLES,
  DEFAULT_SETTINGS,
  scenario as findScenario,
  type RuleSettings,
  SCENARIOS,
} from "@jeswr/agent-sandbox/world";
import {
  Bot,
  ClipboardList,
  Code2,
  GitCompare,
  Menu,
  Plug,
  ScrollText,
  Settings as SettingsIcon,
  SquarePen,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppsSession, type Automation } from "./automations.js";
import { claudeJudge, loadKey, saveKey } from "./claude.js";
import { type AutomationsApi, AutomationsContext } from "./context.js";
import { Icon, STORY_ICONS } from "./icons.js";
import { Session } from "./session.js";
import { AutomationView } from "./views/AutomationView.js";
import { CodeBox } from "./views/CodeBox.js";
import { Compare } from "./views/Compare.js";
import { type ChatState, Home } from "./views/Home.js";
import { Record } from "./views/Record.js";
import { RuleSheet } from "./views/RuleSheet.js";
import { Rules } from "./views/Rules.js";
import { Settings } from "./views/Settings.js";
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

/** Pages under "Under the hood": the policy machinery itself. */
const HOOD = [
  { id: "rules", label: "Rules", icon: ScrollText },
  { id: "systems", label: "Connected systems", icon: Plug },
  { id: "code", label: "Code box", icon: Code2 },
  { id: "compare", label: "Compare", icon: GitCompare },
  { id: "record", label: "Audit log", icon: ClipboardList },
] as const;

type Route =
  | { page: "home" }
  | { page: "automation"; id: string }
  | { page: "story"; id?: string }
  | { page: (typeof HOOD)[number]["id"] };

function readRoute(): Route {
  const [head = "", rest] = location.hash.slice(1).split("/", 2);
  if (head === "automation" && rest) return { page: "automation", id: decodeURIComponent(rest) };
  if (head === "story" || head === "stories")
    return rest ? { page: "story", id: decodeURIComponent(rest) } : { page: "story" };
  const hood = HOOD.find((h) => h.id === head);
  if (hood) return { page: hood.id };
  return { page: "home" };
}

/** What the story and "under the hood" views share. */
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
  /** The live play-through of the chosen story. It outlives page changes. */
  readonly session: Session;
  /** Changes whenever the session does. */
  readonly version: string;
  /** Start the chosen story again from the beginning. */
  restart(): void;
  openSettings(): void;
}

/**
 * The live session for the chosen story, held above the pages so leaving a story keeps its
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
  const version = useSyncExternalStore(
    (l) => session.subscribe(l),
    () =>
      `${session.items.length}:${session.position}:${session.busy}:${session.items.filter((i) => i.kind === "call" && i.settled).length}`,
  );
  return { session, version, restart: () => setGeneration((g) => g + 1) };
}

/** The automations the page starts with: the simplest example, already on. */
function starting(): Automation[] {
  const first = AUTOMATION_EXAMPLES[0];
  return first
    ? [{ rule: first.rule, on: true, draftedBy: "Built-in example", example: first }]
    : [];
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [settings, setSettings] = useState<RuleSettings>(DEFAULT_SETTINGS);
  const [mode, setMode] = useState<EnforcementMode>("policy");
  const [storyId, setStoryId] = useState<string>(SCENARIOS[0]?.id ?? "");
  const [apiKey, setKey] = useState(loadKey);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const judge = useMemo(() => (apiKey ? claudeJudge(apiKey) : standInJudge), [apiKey]);
  const { session, version, restart } = useSession(storyId, mode, settings, judge);

  // Automations.
  const apps = useMemo(() => new AppsSession(), []);
  const [automations, setAutomations] = useState<Automation[]>(starting);
  const [drafts, setDrafts] = useState<Record<string, Automation>>({});
  const [sheet, setSheet] = useState<string | null>(null);
  const [chat, setChatState] = useState<ChatState>({ items: [], busy: false });
  const setChat = useCallback((u: (c: ChatState) => ChatState) => setChatState(u), []);

  useEffect(() => {
    const onHash = () => {
      setRoute(readRoute());
      setMenuOpen(false);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  // A story link chooses the story.
  useEffect(() => {
    if (route.page === "story" && route.id && route.id !== storyId && findScenario(route.id))
      setStoryId(route.id);
  }, [route, storyId]);

  const find = (id: string) => automations.find((a) => a.rule.id === id) ?? drafts[id];
  const api: AutomationsApi = {
    apps,
    automations,
    find,
    addDraft: (a) => setDrafts((d) => ({ ...d, [a.rule.id]: a })),
    showSheet: setSheet,
    setOn: (id, on) =>
      setAutomations((all) => all.map((a) => (a.rule.id === id ? { ...a, on } : a))),
  };
  const sheetAutomation = sheet ? find(sheet) : undefined;
  const sheetIsNew = Boolean(sheet && !automations.some((a) => a.rule.id === sheet));

  const shared: Shared = {
    settings,
    setSettings,
    mode,
    setMode,
    storyId,
    setStoryId(id) {
      location.hash = `#story/${id}`;
      setStoryId(id);
    },
    apiKey,
    setApiKey(key) {
      saveKey(key);
      setKey(key);
    },
    judge,
    judgeIsModel: Boolean(apiKey),
    session,
    version,
    restart,
    openSettings: () => setSettingsOpen(true),
  };

  const here = (page: string, id?: string) =>
    route.page === page && (id === undefined || ("id" in route && route.id === id));

  return (
    <AutomationsContext.Provider value={api}>
      <div className={menuOpen ? "shell menu-open" : "shell"}>
        <aside className="sidebar" aria-label="Navigation">
          <div className="sidebar-top">
            <a className="brand" href="#home">
              <span className="logo" aria-hidden="true">
                ◈
              </span>
              Agent Sandbox
            </a>
            <button
              type="button"
              className="icon-button menu-close"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <a className="new-chat" href="#home" aria-current={here("home") ? "page" : undefined}>
            <SquarePen size={17} aria-hidden="true" /> New automation
          </a>
          <nav aria-label="Your automations">
            <h2 className="nav-title">Your automations</h2>
            {automations.length === 0 && <p className="hint nav-empty">None yet.</p>}
            {automations.map((a) => (
              <a
                key={a.rule.id}
                href={`#automation/${encodeURIComponent(a.rule.id)}`}
                aria-current={here("automation", a.rule.id) ? "page" : undefined}
              >
                <Icon name={a.rule.icon} size={16} />
                <span className="nav-label">{a.rule.title}</span>
                <span className={a.on ? "dot on" : "dot"} title={a.on ? "On" : "Off"} />
              </a>
            ))}
          </nav>
          <nav aria-label="Stories">
            <h2 className="nav-title">Stories</h2>
            {SCENARIOS.filter((s) => !s.code).map((s) => {
              const I = STORY_ICONS[s.id] ?? Bot;
              return (
                <a
                  key={s.id}
                  href={`#story/${s.id}`}
                  aria-current={route.page === "story" && storyId === s.id ? "page" : undefined}
                  title={s.summary}
                >
                  <I size={16} aria-hidden="true" />
                  <span className="nav-label">{s.title}</span>
                </a>
              );
            })}
          </nav>
          <nav aria-label="Under the hood">
            <h2 className="nav-title">Under the hood</h2>
            {HOOD.map((h) => (
              <a key={h.id} href={`#${h.id}`} aria-current={here(h.id) ? "page" : undefined}>
                <h.icon size={16} aria-hidden="true" />
                <span className="nav-label">{h.label}</span>
              </a>
            ))}
          </nav>
          <button type="button" className="settings-button" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={17} aria-hidden="true" /> Settings
            <span className="hint">{apiKey ? "Claude connected" : "No Claude key"}</span>
          </button>
        </aside>
        <div className="content">
          <div className="topbar">
            <button
              type="button"
              className="icon-button"
              aria-label="Open menu"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={20} aria-hidden="true" />
            </button>
            <span className="brand">Agent Sandbox</span>
          </div>
          <main>
            {route.page === "home" && <Home chat={chat} setChat={setChat} apiKey={apiKey} />}
            {route.page === "automation" && (
              <AutomationView id={route.id} apiKey={apiKey} mode={mode} judge={judge} />
            )}
            {route.page === "story" && <Stories shared={shared} />}
            {route.page === "rules" && <Rules shared={shared} />}
            {route.page === "systems" && <Systems shared={shared} />}
            {route.page === "code" && <CodeBox shared={shared} />}
            {route.page === "compare" && <Compare shared={shared} />}
            {route.page === "record" && <Record shared={shared} />}
          </main>
          <footer>
            Harbour &amp; Finch and everything in it is fictional. Every decision is made by real
            ODRL policy code: <code>@jeswr/agent-sandbox</code>, <code>@jeswr/agent-mandate</code>,{" "}
            <code>@jeswr/solid-odrl</code>. Built for the ODI IDEA programme.
          </footer>
        </div>
      </div>
      {sheetAutomation && sheet && (
        <RuleSheet
          key={sheet}
          session={apps}
          automation={sheetAutomation}
          isNew={sheetIsNew}
          onClose={() => setSheet(null)}
          onTurnOn={() => {
            setAutomations((all) => [...all, { ...sheetAutomation, on: true }]);
            setSheet(null);
            location.hash = `#automation/${encodeURIComponent(sheet)}`;
          }}
        />
      )}
      {settingsOpen && <Settings shared={shared} onClose={() => setSettingsOpen(false)} />}
    </AutomationsContext.Provider>
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
          Add your own Claude API key in Settings for a real comparison.
        </p>
      )}
    </fieldset>
  );
}
