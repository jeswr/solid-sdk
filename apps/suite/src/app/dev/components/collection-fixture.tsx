// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import {
  type CollectionErrorKind,
  type CollectionState,
  type DataColumn,
  DataTable,
  FileGrid,
  useSelection,
} from "@jeswr/suite-ui";
import { useMemo, useState } from "react";

type FixtureFile = { id: string; name: string; owner: string; modified: string; size: number };
const files: FixtureFile[] = Array.from({ length: 10000 }, (_, index) => ({
  id: `file-${index}`,
  name:
    [
      "Projects",
      "Holiday photos",
      "Q3 budget.xlsx",
      "Product brief",
      "Reading list.pdf",
      "Notes.md",
    ][index] ?? `Document ${String(index + 1).padStart(5, "0")}`,
  owner: "me",
  modified: "Today, 09:14",
  size: 184 + index,
}));
const fileNames = new Map(files.map((file) => [file.id, file.name]));
const getKey = (file: FixtureFile) => file.id;
const getLabel = (file: FixtureFile) => file.name;
const columns: DataColumn<FixtureFile>[] = [
  {
    id: "name",
    header: "Name",
    accessor: (file) => file.name,
    size: 240,
    minSize: 160,
    hideable: false,
  },
  { id: "owner", header: "Owner", accessor: (file) => file.owner, size: 120 },
  { id: "modified", header: "Modified", accessor: (file) => file.modified, size: 140 },
  {
    id: "size",
    header: "Size",
    accessor: (file) => file.size,
    render: (file) => `${file.size} KB`,
    size: 120,
  },
];
const errorKinds: CollectionErrorKind[] = [
  "reauth",
  "forbidden",
  "not-found",
  "conflict",
  "name-taken",
  "quota",
  "too-large",
  "unreachable",
  "unsupported",
  "unknown",
];
const errorAction: Record<CollectionErrorKind, string> = {
  reauth: "Sign in",
  forbidden: "Switch account",
  "not-found": "Go to parent",
  conflict: "Keep both (copy)",
  "name-taken": "Choose another name",
  quota: "Manage storage",
  "too-large": "Choose another file",
  unreachable: "Retry",
  unsupported: "Learn what your storage supports",
  unknown: "Reload",
};

export function CollectionFixture({ kind }: { kind: "data-table" | "file-grid" }) {
  const selection = useSelection();
  const [query, setQuery] = useState("");
  const [density, setDensity] = useState("comfortable");
  const [message, setMessage] = useState("No file opened");
  const [statesOpen, setStatesOpen] = useState(false);
  const [state, setState] = useState("ready");
  const filtered = useMemo(
    () => files.filter((file) => file.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    [query],
  );
  const onOpen = (file: FixtureFile) => setMessage(`Opened ${file.name}`);
  const onDetails = (file: FixtureFile) => setMessage(`Details for ${file.name}`);
  const shared = {
    getKey,
    getLabel,
    onOpen,
    onDetails,
    columns,
    selection,
    onClearFilters: () => setQuery(""),
    emptyAction: (
      <button type="button" onClick={() => setMessage("Upload a file chosen")}>
        Upload a file
      </button>
    ),
    onRetry: () => setMessage("Retry chosen"),
  };
  const states: { id: string; title: string; state?: CollectionState; filterQuery?: string }[] = [
    { id: "loading", title: "Loading", state: { status: "loading" } },
    { id: "first-use", title: "First use" },
    { id: "filtered", title: "Filtered empty", filterQuery: "annual report" },
    {
      id: "offline",
      title: "Offline without a saved copy",
      state: { status: "offline", cached: false },
    },
    ...errorKinds.map((kind) => ({
      id: kind,
      title: `Error: ${kind}`,
      state: {
        status: "error" as const,
        kind,
        actions: (
          <button type="button" onClick={() => setMessage(`${errorAction[kind]} chosen`)}>
            {errorAction[kind]}
          </button>
        ),
      },
    })),
  ];
  const activeState: CollectionState =
    state === "offline"
      ? { status: "offline", cached: true }
      : { status: state === "refreshing" ? "refreshing" : "ready" };
  function render(
    items: FixtureFile[],
    label: string,
    stateProps: { state?: CollectionState; filterQuery?: string } = {},
  ) {
    const props = { ...shared, items, label, ...stateProps };
    return kind === "data-table" ? (
      <DataTable {...props} />
    ) : (
      <FileGrid {...props} renderMetadata={(file) => `${file.modified} · ${file.size} KB`} />
    );
  }
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="fixture-page suite-collection-fixture"
      data-density={density}
    >
      <div className="fixture-heading">
        <a href="/dev/components">Component fixtures</a>
        <p className="eyebrow">DS-06 · 10,000 files</p>
        <h1>{kind === "data-table" ? "DataTable" : "FileGrid"}</h1>
        <p>
          Arrows or j/k move focus. Space toggles selection. Shift extends a range. Enter opens;
          Alt+Enter shows details.
        </p>
      </div>
      <div className="suite-fixture-controls">
        <label>
          Filter files
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          Density
          <select value={density} onChange={(event) => setDensity(event.target.value)}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        <label>
          Content state
          <select value={state} onChange={(event) => setState(event.target.value)}>
            <option value="ready">Ready</option>
            <option value="refreshing">Refreshing</option>
            <option value="offline">Offline with saved copies</option>
          </select>
        </label>
      </div>
      <section aria-label="Interactive files" data-testid="interactive-collection">
        {render(filtered, "Files", {
          state: activeState,
          ...(query ? { filterQuery: query } : {}),
        })}
      </section>
      <p role="status" data-testid="open-result">
        {message}
      </p>
      <section aria-labelledby="selected-heading">
        <h2 id="selected-heading">Selected files</h2>
        <p data-testid="selected-keys">
          {selection.selectedKeys.size
            ? [...selection.selectedKeys].map((key) => fileNames.get(key)).join(", ")
            : "None"}
        </p>
      </section>
      <button
        type="button"
        aria-expanded={statesOpen}
        onClick={() => setStatesOpen((value) => !value)}
      >
        Show all state fixtures
      </button>
      {statesOpen && (
        <div className="suite-fixture-states">
          {states.map(({ id, title, ...stateProps }) => (
            <section key={id} aria-label={title} data-fixture-state={id}>
              <h2>{title}</h2>
              {render([], `${title} files`, stateProps)}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
