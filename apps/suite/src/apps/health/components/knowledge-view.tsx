// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  EmptyState,
  Input,
  LoadingSkeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@jeswr/suite-ui";
import { BrainCircuit, LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import { factKey } from "../lib/knowledge/view-model";
import { useHealth } from "../state/health-context";
import { KnowledgeProvider, useKnowledge } from "../state/knowledge-context";
import { KnowledgeResults, KnowledgeTimeline } from "./knowledge-charts";
import { KnowledgeDetail } from "./knowledge-detail";
import { KnowledgeFacts, KnowledgeNotes } from "./knowledge-facts";
import { KnowledgeOverview } from "./knowledge-overview";

const TABS = ["overview", "timeline", "results", "facts", "notes"] as const;
type Tab = (typeof TABS)[number];
export function KnowledgeView() {
  const { session } = useHealth();
  return (
    <KnowledgeProvider key={`${session.mode}:${session.webId}`} session={session}>
      <KnowledgePage />
    </KnowledgeProvider>
  );
}
function KnowledgeFile() {
  const { owner, setOwner, busy, loading, openFile, applyOwner, hasFile, data } = useKnowledge();
  return (
    <section className="hlt-panel hlt-knowledge-file" aria-labelledby="hlt-knowledge-file-title">
      <h2 id="hlt-knowledge-file-title">Open a knowledge graph file</h2>
      <p className="hlt-muted" id="hlt-knowledge-file-privacy">
        The file is read in this browser and never uploaded.
      </p>
      <form
        className="hlt-form"
        onSubmit={(event) => {
          event.preventDefault();
          void applyOwner();
        }}
      >
        <label htmlFor="hlt-knowledge-owner">Owner WebID</label>
        <Input
          id="hlt-knowledge-owner"
          type="url"
          required
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
          disabled={busy || loading}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="hlt-small hlt-muted">
          Use the WebID of the person the file describes. It may be a different account.
        </p>
        {hasFile && (
          <Button type="submit" variant="outline" disabled={busy}>
            Apply owner to open file
          </Button>
        )}
        <label htmlFor="hlt-knowledge-file">Choose a knowledge graph file</label>
        <input
          id="hlt-knowledge-file"
          type="file"
          accept=".trig,.nq,.ttl,application/trig"
          disabled={busy || loading}
          aria-describedby="hlt-knowledge-file-privacy"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void openFile(file);
            event.target.value = "";
          }}
        />
      </form>
      {data?.source === "file" && (
        <p className="hlt-small hlt-muted" role="status">
          {data.skipped?.count ?? 0} nanopublications skipped
          {Object.entries(data.skipped?.reasons ?? {})
            .map(([reason, count]) => ` · ${reason}: ${count}`)
            .join("")}
          .
        </p>
      )}
    </section>
  );
}
function KnowledgePage() {
  const { data, loading, busy, error } = useKnowledge();
  const [tab, setTab] = useState<Tab>("overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const read = () => {
      const next = location.hash.slice(1);
      if (TABS.includes(next as Tab)) setTab(next as Tab);
    };
    read();
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("hashchange", read);
      window.removeEventListener("popstate", read);
    };
  }, []);
  const changeTab = (next: string) => {
    if (!TABS.includes(next as Tab)) return;
    setTab(next as Tab);
    // Only the selected tab enters the URL. Health data stays in React memory.
    history.replaceState(null, "", `#${next}`);
  };
  const fact = data?.view.facts.find((f) => factKey(f) === selected) ?? null;
  return (
    <div className="hlt-page hlt-knowledge">
      <header className="hlt-page-header">
        <div>
          <p className="hlt-eyebrow">
            <BrainCircuit size={16} aria-hidden="true" /> ASSISTANT KNOWLEDGE
          </p>
          <h1>What your assistant knows</h1>
          <p className="hlt-muted">
            Health facts drawn from your conversations, with their sources and uncertainty. You have
            the final say.
          </p>
        </div>
        <span className="hlt-private">
          <LockKeyhole size={14} aria-hidden="true" /> Private to you
        </span>
      </header>
      <KnowledgeFile />
      {error && (
        <p role="alert" className="hlt-info-note">
          {error}
        </p>
      )}
      {busy && <p role="status">Working in this browser…</p>}
      {loading ? (
        <LoadingSkeleton preset="grid" label="Opening fictional knowledge sample" />
      ) : !data ? (
        <EmptyState
          title="Your pod knowledge is coming"
          body="Reading assistant knowledge from your pod is coming. Open a knowledge graph file above to explore it privately in this browser."
        />
      ) : (
        <>
          <p className="hlt-info-note" role="status" aria-label="Knowledge data source">
            {data.source === "demo"
              ? "Fictional sample · Changes last for this visit only."
              : "Local file · Read-only · Open it from your pod to make changes"}
            <span className="hlt-knowledge-owner">Owner: {data.owner}</span>
          </p>
          <Tabs value={tab} onValueChange={changeTab} className="hlt-knowledge-tabs">
            <TabsList className="hlt-knowledge-tablist" aria-label="Assistant knowledge views">
              {TABS.map((id) => (
                <TabsTrigger value={id} key={id}>
                  {id[0]?.toUpperCase()}
                  {id.slice(1)}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="overview">
              <KnowledgeOverview
                view={data.view}
                onReview={(label) => {
                  setQuery(label);
                  changeTab("facts");
                }}
              />
            </TabsContent>
            <TabsContent value="timeline">
              <KnowledgeTimeline view={data.view} />
            </TabsContent>
            <TabsContent value="results">
              <KnowledgeResults view={data.view} onSelect={(f) => setSelected(factKey(f))} />
            </TabsContent>
            <TabsContent value="facts">
              <KnowledgeFacts
                view={data.view}
                query={query}
                setQuery={setQuery}
                onSelect={(f) => setSelected(factKey(f))}
              />
            </TabsContent>
            <TabsContent value="notes">
              <KnowledgeNotes view={data.view} onSelect={(f) => setSelected(factKey(f))} />
            </TabsContent>
          </Tabs>
          <KnowledgeDetail
            key={selected}
            fact={fact}
            onClose={() => setSelected(null)}
            onSelect={(f) => setSelected(factKey(f))}
          />
          <p className="hlt-muted hlt-small">
            {data.view.unrecognised.length} unrecognised records · {data.view.excludedOtherSubjects}{" "}
            nanopublications with records for other people excluded. Beliefs reflect what was said;
            they are not clinical conclusions.
          </p>
        </>
      )}
    </div>
  );
}
