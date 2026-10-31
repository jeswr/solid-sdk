// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { Breadcrumbs, EditableText, FilterChips, TagInput, Toolbar } from "@jeswr/suite-ui";
import { useState } from "react";

export type Ds07Component =
  | "toolbar"
  | "filter-chips"
  | "breadcrumbs"
  | "editable-text"
  | "tag-input";
const names: Record<Ds07Component, string> = {
  toolbar: "Toolbar",
  "filter-chips": "Filter chips",
  breadcrumbs: "Breadcrumbs",
  "editable-text": "Editable text",
  "tag-input": "Tag input",
};
const filters = [
  { id: "documents", label: "Documents" },
  { id: "images", label: "Images" },
  { id: "shared", label: "Shared" },
  { id: "archived", label: "Archived", disabled: true },
];
const tags = [
  { id: "work", label: "Work" },
  { id: "personal", label: "Personal" },
  { id: "finance", label: "Finance" },
  { id: "research", label: "Research" },
];

export function Ds07Fixture({ component }: { component: Ds07Component }) {
  const [message, setMessage] = useState("Ready");
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);
  const [emptyFilters, setEmptyFilters] = useState<string[]>(["documents"]);
  const [newFilters, setNewFilters] = useState<string[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>(["work"]);
  const [title, setTitle] = useState("Q4 launch plan");
  const actions = [
    { id: "upload", label: "Upload files", primary: true },
    { id: "new", label: "New folder" },
    { id: "share", label: "Share" },
    { id: "download", label: "Download" },
    { id: "move", label: "Move to…" },
    { id: "delete", label: "Delete", disabled: true },
  ].map((action) => ({ ...action, onSelect: () => setMessage(`${action.label} selected`) }));
  const crumbs = [
    { id: "drive", label: "My Drive" },
    { id: "work", label: "Work" },
    { id: "projects", label: "Projects" },
    { id: "marketing", label: "Marketing" },
    { id: "campaigns", label: "Campaigns" },
  ].map((crumb) => ({
    ...crumb,
    href: `/dev/components/breadcrumbs?folder=${crumb.id}`,
    onDrop: (event: React.DragEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      setMessage(`Moved sample to ${crumb.label}`);
    },
  }));
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page ds07-page">
      <header className="fixture-heading">
        <p className="eyebrow">Solid Suite · DS-07</p>
        <h1>{names[component]}</h1>
        <p className="suite-hint">Responsive controls · Comfortable density</p>
        <a href="/dev/components">All component fixtures</a>
      </header>
      {component === "toolbar" && (
        <>
          <section className="foundation-card ds07-stack" aria-labelledby="interactive-title">
            <h2 id="interactive-title">File actions</h2>
            <Toolbar label="File actions" actions={actions} />
            <p className="suite-hint">
              Use Left and Right to move between actions. More contains actions that do not fit.
            </p>
          </section>
          <section className="foundation-card ds07-stack" aria-labelledby="narrow-title">
            <h2 id="narrow-title">Narrow action bar</h2>
            <div className="ds07-narrow">
              <Toolbar label="Narrow file actions" actions={actions} />
            </div>
          </section>
          <section className="foundation-card ds07-stack" aria-labelledby="disabled-title">
            <h2 id="disabled-title">Unavailable actions</h2>
            <Toolbar
              label="Unavailable actions"
              actions={actions.map((action) => ({ ...action, disabled: true }))}
            />
          </section>
          <section className="foundation-card ds07-stack" aria-labelledby="empty-title">
            <h2 id="empty-title">No selection</h2>
            <Toolbar label="No selection" actions={[]} />
            <p className="suite-hint">Select a file to see its actions.</p>
          </section>
        </>
      )}
      {component === "filter-chips" && (
        <>
          <section className="foundation-card ds07-stack" aria-labelledby="interactive-title">
            <h2 id="interactive-title">Interactive filters</h2>
            <FilterChips
              label="File types"
              options={filters}
              value={selectedFilters}
              onChange={setSelectedFilters}
              resultCount={
                selectedFilters.length ? Math.max(0, 12 - selectedFilters.length * 4) : 24
              }
            />
          </section>
          <section className="foundation-card ds07-stack" aria-labelledby="empty-title">
            <h2 id="empty-title">First use</h2>
            <FilterChips
              label="New drive filters"
              options={filters}
              value={newFilters}
              onChange={setNewFilters}
              resultCount={0}
            />
            <p className="suite-hint">Upload a file to get started.</p>
            <button
              className="suite-button suite-primary"
              type="button"
              onClick={() => setMessage("Upload files selected")}
            >
              Upload a file
            </button>
          </section>
          <section className="foundation-card ds07-stack" aria-labelledby="filtered-title">
            <h2 id="filtered-title">Filtered empty</h2>
            <FilterChips
              label="Empty results filters"
              options={filters}
              value={emptyFilters}
              onChange={setEmptyFilters}
              resultCount={0}
            />
            <p className="suite-hint">
              {emptyFilters.length ? "No results for 'Documents'" : "No files yet"}
            </p>
          </section>
        </>
      )}
      {component === "breadcrumbs" && (
        <>
          <section className="foundation-card ds07-stack" aria-labelledby="interactive-title">
            <h2 id="interactive-title">Folder path</h2>
            <Breadcrumbs items={crumbs} />
            <p className="suite-hint">Drop a sample on any folder, or use the Move button.</p>
            <button
              className="suite-button"
              type="button"
              onClick={() => setMessage("Moved sample to Campaigns")}
            >
              Move sample to Campaigns
            </button>
          </section>
          <section className="foundation-card ds07-stack" aria-labelledby="narrow-title">
            <h2 id="narrow-title">Narrow folder path</h2>
            <div className="ds07-narrow">
              <Breadcrumbs label="Narrow folder path" items={crumbs} />
            </div>
          </section>
          <section className="foundation-card ds07-stack" aria-labelledby="root-title">
            <h2 id="root-title">Root folder</h2>
            <Breadcrumbs label="Root folder" items={crumbs.slice(0, 1)} />
          </section>
          <section className="foundation-card ds07-stack" aria-labelledby="long-title">
            <h2 id="long-title">Long folder names</h2>
            <Breadcrumbs
              label="Long folder names"
              items={[
                {
                  id: "drive",
                  label: "My Drive",
                  href: "/dev/components/breadcrumbs?folder=drive",
                },
                {
                  id: "long",
                  label: "Research and planning for the upcoming winter campaign",
                  href: "/dev/components/breadcrumbs?folder=long",
                },
              ]}
            />
          </section>
        </>
      )}
      {component === "editable-text" && (
        <>
          <section className="foundation-card ds07-stack" aria-labelledby="interactive-title">
            <h2 id="interactive-title">Rename a document</h2>
            <EditableText
              label="Document name"
              value={title}
              onCommit={(value) => {
                setTitle(value);
                setMessage("Name saved");
              }}
              validate={(value) =>
                !value.trim()
                  ? "Enter a name"
                  : value === "Taken"
                    ? "A file with this name already exists"
                    : undefined
              }
            />
            <p className="suite-hint">
              Click the name or press F2. Try an empty name or “Taken” to see validation.
            </p>
          </section>
          <section className="foundation-card ds07-stack" aria-labelledby="disabled-title">
            <h2 id="disabled-title">Read only</h2>
            <EditableText
              label="Shared document name"
              value="Team handbook"
              onCommit={() => {}}
              disabled
            />
          </section>
          <section className="foundation-card ds07-stack" aria-labelledby="empty-title">
            <h2 id="empty-title">Untitled document</h2>
            <EditableText label="New document name" value={newTitle} onCommit={setNewTitle} />
          </section>
        </>
      )}
      {component === "tag-input" && (
        <>
          <section className="foundation-card ds07-stack" aria-labelledby="interactive-title">
            <h2 id="interactive-title">Document labels</h2>
            <TagInput
              label="Labels"
              options={tags}
              value={selectedTags}
              onChange={setSelectedTags}
            />
            <p className="suite-hint">
              Type to filter suggestions. Backspace in an empty field removes the last label.
            </p>
          </section>
          <section className="foundation-card ds07-stack" aria-labelledby="empty-title">
            <h2 id="empty-title">First use</h2>
            <TagInput label="New collection labels" options={[]} value={[]} onChange={() => {}} />
          </section>
          <section className="foundation-card ds07-stack" aria-labelledby="disabled-title">
            <h2 id="disabled-title">Read only</h2>
            <TagInput
              label="Shared labels"
              options={tags}
              value={["personal", "finance"]}
              onChange={() => {}}
              disabled
            />
          </section>
        </>
      )}
      <p className="suite-hint" role="status" aria-live="polite">
        {message}
      </p>
    </main>
  );
}
