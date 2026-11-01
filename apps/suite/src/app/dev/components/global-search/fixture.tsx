// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Input, Label, TooltipProvider } from "@jeswr/suite-ui";
import { useMemo, useState } from "react";
import type { SearchResult, SearchSource } from "../../../../shell/lib/search-results";
import { CommandPalette } from "../../../../shell/search/command-palette";
import { GlobalSearch } from "../../../../shell/search/global-search";
import { createLocalSearchSource } from "../../../../shell/search/local-source";
import { SearchResultsView } from "../../../../shell/search/results-view";
import { GlobalShortcuts } from "../../../../shell/shortcuts/global-shortcuts";
import { ShortcutHelpSheet, ShortcutsTable } from "../../../../shell/shortcuts/help-sheet";
import { ShortcutsProvider, useShortcut } from "../../../../shell/shortcuts/provider";

const syntheticResults: SearchResult[] = [
  ...Array.from(
    { length: 8 },
    (_, index): SearchResult => ({
      id: `file-${index}`,
      title: `Project file ${index + 1}.pdf`,
      type: "file",
      app: "drive",
      href: `/drive?file=${index}`,
      parent: "My Drive / Projects",
      modified: new Date("2026-10-29T12:00:00Z"),
      owner: "https://example.org/account",
    }),
  ),
  {
    id: "document",
    title: "Project plan",
    type: "document",
    app: "docs",
    href: "/docs",
    parent: "Documents",
  },
  {
    id: "task",
    title: "Project checklist",
    type: "task",
    app: "tasks",
    href: "/tasks",
    parent: "Inbox",
  },
  {
    id: "person",
    title: "Project contact: Rowan Vale",
    type: "person",
    app: "contacts",
    href: "/contacts",
    parent: "Contacts",
  },
  {
    id: "data",
    title: "Project data",
    type: "data",
    app: "home",
    href: "/home",
    parent: "My data",
  },
];
function ScopedShortcut({ enabled }: { enabled: boolean }) {
  const [message, setMessage] = useState("");
  useShortcut({
    id: "fixture.app",
    keys: "x",
    label: "App action",
    group: "Drive",
    when: () => enabled,
    run: () => setMessage("App action"),
  });
  useShortcut({
    id: "fixture.editor",
    keys: "x",
    label: "Editor action",
    group: "Drive",
    scope: "editor",
    when: () => enabled,
    run: () => setMessage("Editor action"),
  });
  return <p role="status">{message}</p>;
}
function FixtureContent({
  component,
}: {
  component: "global-search" | "command-palette" | "shortcut-help";
}) {
  const [state, setState] = useState("ready");
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [message, setMessage] = useState("");
  const source = useMemo<SearchSource>(() => {
    const local = createLocalSearchSource(syntheticResults);
    return {
      async search(query, options) {
        if (state === "slow")
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 1200);
            options.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
          });
        options.signal.throwIfAborted();
        if (state === "error") throw new Error("Synthetic search failure");
        if (state === "empty") return { results: [], source: "local", serverSearch: false };
        return local.search(query, options);
      },
    };
  }, [state]);
  return (
    <main id="main-content" className="fixture-page min-w-0" tabIndex={-1}>
      <h1>
        {component === "global-search"
          ? "Global search"
          : component === "command-palette"
            ? "Command palette"
            : "Keyboard shortcuts"}
      </h1>
      <a href="/dev/components">All component fixtures</a>
      <GlobalShortcuts
        onOpenPalette={() => setPalette((value) => !value)}
        onOpenHelp={() => setHelp(true)}
      />
      <div className="my-6 grid gap-4">
        <Label htmlFor="search-fixture-state">Fixture state</Label>
        <select
          className="min-h-10 rounded border bg-background p-2"
          id="search-fixture-state"
          value={state}
          onChange={(event) => setState(event.target.value)}
        >
          {["ready", "slow", "error", "empty", "results", "results-error"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <GlobalSearch
          source={source}
          scope={{ app: "drive", label: "Drive" }}
          onOpen={(result) => setMessage(`Opened ${result.title}`)}
          onSeeAll={(query, scope) =>
            setMessage(`All results for ${query}${scope ? ` in ${scope}` : " everywhere"}`)
          }
        />
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setPalette(true)}>Open command palette</Button>
          <Button onClick={() => setHelp(true)}>Show keyboard shortcuts</Button>
        </div>
        <Label htmlFor="shortcut-typing">Typing area</Label>
        <Input id="shortcut-typing" placeholder="Single keys stay in this input" />
        <div data-shortcuts="off">
          <Label htmlFor="shortcuts-off">Shortcuts disabled</Label>
          <Input id="shortcuts-off" />
        </div>
        <p role="status">{message}</p>
        <ScopedShortcut enabled={component === "shortcut-help"} />
        {component === "shortcut-help" && <ShortcutsTable />}
        {(state === "results" || state === "results-error") && (
          <SearchResultsView
            query="project"
            results={syntheticResults}
            accountId="https://example.org/account"
            {...(state === "results-error"
              ? { error: "unreachable" as const, onRetry: () => setState("results") }
              : {})}
            onOpen={(result) => setMessage(`Opened ${result.title}`)}
          />
        )}
      </div>
      <CommandPalette
        open={palette}
        onOpenChange={setPalette}
        createActions={[
          {
            id: "new-document",
            label: "New document",
            run: () => setMessage("Created a document"),
          },
        ]}
        recent={[{ id: "recent-plan", title: "Planning notes", href: "/docs", app: "docs" }]}
        onSearch={(query) => setMessage(`Palette search for ${query}`)}
      />
      <ShortcutHelpSheet open={help} onOpenChange={setHelp} />
    </main>
  );
}
export function ShellSearchFixture({
  component = "global-search",
}: {
  component?: "global-search" | "command-palette" | "shortcut-help";
}) {
  return (
    <TooltipProvider>
      <ShortcutsProvider platform="Linux">
        <FixtureContent component={component} />
      </ShortcutsProvider>
    </TooltipProvider>
  );
}
