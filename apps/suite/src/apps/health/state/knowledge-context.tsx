// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  correctHealthFact,
  forgetHealthFact,
  type HealthFact,
  type HealthGraphView,
  importHealthExport,
  projectHealthFacts,
} from "@jeswr/pkg-health";
import type { Fact, NanopubStore } from "@jeswr/pkg-memory";
import { toast } from "@jeswr/suite-ui";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { createKnowledgeDemo } from "../lib/knowledge/demo";

type KnowledgeData = {
  view: HealthGraphView;
  owner: string;
  source: "demo" | "file";
  store?: NanopubStore;
  skipped?: { count: number; reasons: Record<string, number> };
};
interface KnowledgeContextValue {
  data: KnowledgeData | null;
  loading: boolean;
  busy: boolean;
  error: string;
  owner: string;
  setOwner(owner: string): void;
  hasFile: boolean;
  openFile(file: File): Promise<void>;
  applyOwner(): Promise<void>;
  forget(fact: HealthFact): Promise<void>;
  correct(fact: HealthFact, replacement: Fact): Promise<void>;
}
const Context = createContext<KnowledgeContextValue | null>(null);
export function KnowledgeProvider({
  session,
  children,
}: {
  session: PodSession;
  children: ReactNode;
}) {
  const [data, setData] = useState<KnowledgeData | null>(null);
  const [owner, setOwner] = useState(session.webId);
  const [loading, setLoading] = useState(session.mode === "demo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasFile, setHasFile] = useState(false);
  const fileText = useRef<string | null>(null);
  const generation = useRef(0);
  const working = useRef(false);
  useEffect(() => {
    const request = ++generation.current;
    if (session.mode === "demo") {
      void createKnowledgeDemo()
        .then(({ owner: demoOwner, store, value }) => {
          const view = projectHealthFacts(value, { owner: demoOwner });
          if (generation.current !== request) return;
          setOwner(demoOwner);
          setData({ owner: demoOwner, store, source: "demo", view });
          setLoading(false);
        })
        .catch(() => {
          if (generation.current !== request) return;
          setError("Couldn't open the fictional sample. Reload to try again.");
          setLoading(false);
        });
    }
    return () => {
      ++generation.current;
    };
  }, [session.mode]);

  async function loadFile(read: () => Promise<string>) {
    if (working.current) return;
    working.current = true;
    const request = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const text = await read();
      const imported = await importHealthExport(text, { owner: owner.trim() });
      const view = projectHealthFacts(imported.value, { owner: owner.trim() });
      if (generation.current !== request) return;
      fileText.current = text;
      setHasFile(true);
      setData({ owner: owner.trim(), source: "file", skipped: imported.skipped, view });
    } catch {
      if (generation.current === request)
        setError(
          "Couldn't open this knowledge graph. Check the file and the owner's HTTP(S) WebID.",
        );
    } finally {
      working.current = false;
      if (generation.current === request) {
        setBusy(false);
        setLoading(false);
      }
    }
  }
  async function mutate(fact: HealthFact, replacement?: Fact) {
    if (
      working.current ||
      !data?.store ||
      data.source !== "demo" ||
      fact.validity !== "Current" ||
      fact.belief === "past"
    )
      return;
    const current = data.view.facts.find(
      (f) => f.id === fact.id && f.subject === fact.subject && f.kind === fact.kind,
    );
    if (current !== fact) return;
    working.current = true;
    const request = generation.current;
    setBusy(true);
    setError("");
    try {
      const options = {
        clientId: new URL("/health/knowledge", window.location.origin).href,
        batchId: crypto.randomUUID(),
      };
      if (replacement) await correctHealthFact(data.store, fact.id, replacement, options);
      else await forgetHealthFact(data.store, fact.id, options);
      const view = projectHealthFacts(await data.store.list(), { owner: data.owner });
      if (generation.current !== request) return;
      setData({ ...data, view });
      toast.success(
        replacement
          ? "Correction saved. The earlier fact is now Past."
          : "Fact forgotten. The history is kept.",
      );
    } catch {
      if (generation.current === request) {
        setError("Couldn't save this change. Reopen the fact and try again.");
        throw new Error("Knowledge change failed");
      }
    } finally {
      working.current = false;
      if (generation.current === request) setBusy(false);
    }
  }
  return (
    <Context
      value={{
        data,
        owner,
        setOwner,
        loading,
        busy,
        error,
        hasFile,
        openFile: (file) => loadFile(() => file.text()),
        applyOwner: () =>
          fileText.current === null
            ? Promise.resolve()
            : loadFile(async () => fileText.current as string),
        forget: (fact) => mutate(fact),
        correct: (fact, replacement) => mutate(fact, replacement),
      }}
    >
      {children}
    </Context>
  );
}
export function useKnowledge() {
  const value = useContext(Context);
  if (!value) throw new Error("Knowledge provider is required");
  return value;
}
