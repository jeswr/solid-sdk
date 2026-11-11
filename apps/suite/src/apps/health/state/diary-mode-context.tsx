// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import type { TriggerSlug } from "@jeswr/solid-health-diary";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createDiaryPreferencesStore,
  DEFAULT_DIARY_PREFERENCES,
  type DiaryPreferences,
} from "../lib/data/diary-preferences";
import { useHealth } from "./health-context";

interface DiaryMode {
  enabled: boolean;
  preferences: DiaryPreferences;
  trigger: TriggerSlug;
  chooseTrigger(trigger: TriggerSlug): void;
  visitOnly: boolean;
  loading: boolean;
  saving: boolean;
  error: string;
  activate(): void;
  forVisit(): void;
  save(value: DiaryPreferences): Promise<void>;
}
const Context = createContext<DiaryMode | null>(null);
export function DiaryModeProvider({ children }: { children: ReactNode }) {
  const { session, boot } = useHealth();
  const store = useMemo(
    () => createDiaryPreferencesStore(session.fetch, session.storageUrl, session.webId),
    [session],
  );
  const [preferences, setPreferences] = useState(DEFAULT_DIARY_PREFERENCES);
  const [visit, setVisit] = useState(false);
  const [visitTrigger, setVisitTrigger] = useState<TriggerSlug | undefined>();
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const writing = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    if (!active || boot.status !== "ready") return;
    let live = true;
    const token = generation.current;
    void store
      .read()
      .then(
        (value) => {
          if (live && generation.current === token) {
            setPreferences(value);
            setError("");
          }
        },
        () => {
          if (live) setError("Couldn't load diary settings. Try reopening the diary.");
        },
      )
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [active, store, boot.status]);
  const activate = useCallback(() => setActive(true), []);
  const forVisit = useCallback(() => setVisit(true), []);
  async function save(value: DiaryPreferences) {
    if (writing.current || loading) return;
    writing.current = true;
    generation.current++;
    setSaving(true);
    setError("");
    try {
      await store.save(value);
      setPreferences(value);
      setVisit(false);
      setVisitTrigger(undefined);
    } catch {
      setError("Couldn't save diary settings. Check your connection and try again.");
    } finally {
      writing.current = false;
      setSaving(false);
    }
  }
  return (
    <Context
      value={{
        enabled: visit || preferences.enabled,
        preferences,
        trigger: visitTrigger ?? preferences.trigger,
        chooseTrigger: (trigger) => {
          if (visit && !preferences.enabled) setVisitTrigger(trigger);
          else void save({ ...preferences, trigger });
        },
        visitOnly: visit && !preferences.enabled,
        loading,
        saving,
        error,
        activate,
        forVisit,
        save,
      }}
    >
      {children}
    </Context>
  );
}
export function useDiaryMode() {
  const value = useContext(Context);
  if (!value) throw new Error("Diary mode provider is required");
  const { activate } = value;
  useEffect(activate, [activate]);
  return value;
}
