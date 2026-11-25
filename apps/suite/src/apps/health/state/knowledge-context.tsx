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
import { MAX_KNOWLEDGE_FACTS, MAX_KNOWLEDGE_FILE_BYTES } from "../lib/knowledge/view-model";

const TOO_LARGE_FILE =
  "This file is larger than 16 MiB, so it was not opened. Choose a smaller knowledge graph export.";
const TOO_MANY_FACTS =
  "This file holds more health facts than this view can show safely, so it was not opened. Choose a smaller export.";
class RefusedFile extends Error {}

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
  /** Resolves false when the change was refused (stale fact, not Current, or another change running). */
  forget(fact: HealthFact): Promise<boolean>;
  correct(fact: HealthFact, replacement: Fact): Promise<boolean>;
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

  async function loadFile(read: () => Promise<string>, size = 0) {
    if (working.current) return;
    working.current = true;
    const request = ++generation.current;
    if (size > MAX_KNOWLEDGE_FILE_BYTES) {
      // Refused before reading: nothing from the file is held, and the message holds no values.
      working.current = false;
      setError(TOO_LARGE_FILE);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const text = await read();
      const imported = await importHealthExport(text, { owner: owner.trim() });
      const view = projectHealthFacts(imported.value, { owner: owner.trim() });
      if (view.facts.length > MAX_KNOWLEDGE_FACTS) throw new RefusedFile();
      if (generation.current !== request) return;
      fileText.current = text;
      setHasFile(true);
      setData({ owner: owner.trim(), source: "file", skipped: imported.skipped, view });
    } catch (cause) {
      if (generation.current === request)
        setError(
          cause instanceof RefusedFile
            ? TOO_MANY_FACTS
            : "Couldn't open this knowledge graph. Check the file and the owner's HTTP(S) WebID.",
        );
    } finally {
      working.current = false;
      if (generation.current === request) {
        setBusy(false);
        setLoading(false);
      }
    }
  }
  async function mutate(fact: HealthFact, replacement?: Fact): Promise<boolean> {
    if (
      working.current ||
      !data?.store ||
      data.source !== "demo" ||
      fact.validity !== "Current" ||
      fact.belief === "past"
    )
      return false;
    const current = data.view.facts.find(
      (f) => f.id === fact.id && f.subject === fact.subject && f.kind === fact.kind,
    );
    if (current !== fact) return false;
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
      if (generation.current !== request) return false;
      setData({ ...data, view });
      toast.success(
        replacement
          ? "Correction saved. The earlier fact is now Past."
          : "Fact forgotten. The history is kept.",
      );
      return true;
    } catch {
      if (generation.current === request) {
        setError("Couldn't save this change. Reopen the fact and try again.");
        throw new Error("Knowledge change failed");
      }
      return false;
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
        openFile: (file) => loadFile(() => file.text(), file.size),
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
