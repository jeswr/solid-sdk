// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { Button, EmptyState, ErrorState, LoadingSkeleton, Toaster } from "@jeswr/suite-ui";
import { ArrowLeft, Globe2, PenLine, Plus } from "lucide-react";
import { useState } from "react";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppHeading, AppSessionGuard } from "@/shell/app-frame";
import { useConnectionState } from "@/shell/sync/connection-state";
import { PublishProvider, usePublish } from "../state/publish-context";
import { PageEditor } from "./page-editor";
import { SiteDialog, SiteView } from "./site-view";
import "./publish.css";

function Boot({
  error = false,
  retry = () => location.reload(),
}: {
  error?: boolean;
  retry?: () => void;
}) {
  return (
    <div className="pub-boot">
      <AppHeading>{error ? "Couldn't open Publish" : "Opening Publish"}</AppHeading>
      {error ? (
        <ErrorState error="unreachable" actions={{ retry }}>
          <p>
            We couldn't confirm private storage for your drafts. Check your connection and pod
            permissions, then retry.
          </p>
        </ErrorState>
      ) : (
        <LoadingSkeleton label="Opening your publishing workspace" preset="list" />
      )}
    </div>
  );
}
function Workspace() {
  const { snapshot, workspace, session } = usePublish();
  const [selectedSite, selectSite] = useState<string>();
  const [selectedPage, selectPage] = useState<string>();
  const [creating, setCreating] = useState(false);
  const connection = useConnectionState();
  const site = snapshot.sites.find((s) => s.url === selectedSite);
  const pages = site ? (snapshot.pages[site.url] ?? []) : [];
  const page = pages.find((p) => p.url === selectedPage);
  function choose(url?: string) {
    selectSite(url);
    selectPage(undefined);
  }
  return (
    <AppFrame
      app="publish"
      context={<span>Publish · {site?.data.name ?? "Your sites"}</span>}
      sidebar={
        <div className="pub-sidebar">
          <div className="pub-brand">
            <PenLine size={23} aria-hidden="true" />
            <strong>Publish</strong>
          </div>
          <p className="pub-muted">A little corner of the web.</p>
          <nav aria-label="Publish navigation">
            <Button variant={!site ? "secondary" : "ghost"} onClick={() => choose()}>
              All sites
            </Button>
            {snapshot.sites.map((value) => (
              <Button
                key={value.url}
                variant={site?.url === value.url ? "secondary" : "ghost"}
                onClick={() => choose(value.url)}
                aria-pressed={site?.url === value.url}
              >
                <Globe2 size={16} aria-hidden="true" />
                {value.data.name}
              </Button>
            ))}
          </nav>
          <p className="pub-sidebar-note">Write privately. Publish when you're ready.</p>
          {session.mode === "demo" && (
            <p className="pub-muted">Demo · fictional writing and example public URLs</p>
          )}
        </div>
      }
    >
      <div className="pub-workspace">
        {connection !== "online" && (
          <p className="pub-notice" role="status">
            You're offline. You can keep writing; reconnect to save or publish.
          </p>
        )}
        {snapshot.error && (
          <div className="pub-notice" role="alert">
            <p>{snapshot.error}</p>
            <Button
              size="sm"
              variant="outline"
              disabled={snapshot.pending > 0 || connection !== "online"}
              onClick={() => void workspace.load()}
            >
              Reload from pod
            </Button>
          </div>
        )}
        {snapshot.status === "loading" ? (
          <LoadingSkeleton label="Loading your sites" preset="grid" />
        ) : snapshot.status === "error" ? (
          <ErrorState error="unreachable" actions={{ retry: () => void workspace.load() }} />
        ) : page && site ? (
          <>
            <Button className="pub-back" variant="ghost" onClick={() => selectPage(undefined)}>
              <ArrowLeft size={16} aria-hidden="true" />
              Back to pages
            </Button>
            <PageEditor key={page.url} site={site} page={page} pages={pages} />
          </>
        ) : site ? (
          <SiteView key={site.url} site={site} pages={pages} openPage={selectPage} />
        ) : (
          <>
            <header className="pub-page-header">
              <div>
                <p className="pub-eyebrow">Your own web</p>
                <AppHeading>Your sites</AppHeading>
                <p className="pub-muted">Make something worth sharing. Keep it in your pod.</p>
              </div>
              <Button onClick={() => setCreating(true)} disabled={connection !== "online"}>
                <Plus size={16} aria-hidden="true" />
                Create site
              </Button>
            </header>
            {snapshot.sites.length ? (
              <div className="pub-site-grid">
                {snapshot.sites.map((value) => {
                  const entries = snapshot.pages[value.url] ?? [];
                  return (
                    <article className="pub-site-card" key={value.url}>
                      <div className="pub-card-icon">
                        <PenLine size={26} aria-hidden="true" />
                      </div>
                      <p className="pub-eyebrow">{value.data.theme} theme</p>
                      <h3>
                        <Button variant="link" onClick={() => choose(value.url)}>
                          {value.data.name}
                        </Button>
                      </h3>
                      <p>{value.data.description || "A new place for your words."}</p>
                      <div className="pub-card-footer">
                        <span>
                          {entries.length} {entries.length === 1 ? "page" : "pages"} ·{" "}
                          {entries.filter((p) => p.data.status === "published").length} published
                        </span>
                        <span className="pub-status">
                          {value.data.publicUrl ? "Public" : "Private drafts"}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="Your first site starts here"
                body="A blog, a project or a place to collect your ideas. Write in Markdown and share a public link when you're ready."
                icon={<PenLine aria-hidden="true" />}
                primaryAction={
                  <Button disabled={connection !== "online"} onClick={() => setCreating(true)}>
                    Create your first site
                  </Button>
                }
              />
            )}
          </>
        )}
        <div className="pub-save-status" role="status" aria-live="polite">
          {snapshot.pending ? "Saving to your pod…" : ""}
        </div>
        <SiteDialog
          open={creating}
          close={() => setCreating(false)}
          created={(url) => {
            setCreating(false);
            choose(url);
          }}
        />
      </div>
    </AppFrame>
  );
}
function Session() {
  const state = usePodSessionState();
  if (state.status === "loading") return <Boot />;
  if (state.status === "error") return <Boot error />;
  if (state.status === "signed-out")
    return (
      <div className="pub-boot">
        <AppHeading>Publish</AppHeading>
        <p>Sign in to open your sites.</p>
      </div>
    );
  return (
    <PublishProvider
      key={`${state.session.mode}:${state.session.webId}`}
      session={state.session}
      fallback={(error, retry) => <Boot error={error} retry={retry} />}
    >
      <Workspace />
    </PublishProvider>
  );
}
export function PublishApp() {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <Session />
        <Toaster position="bottom-center" />
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
