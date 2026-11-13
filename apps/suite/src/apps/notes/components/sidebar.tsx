// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Input,
  toast,
} from "@jeswr/suite-ui";
import { Archive, Bell, Import, Pencil, Search, StickyNote, Tag, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRoutePathname } from "@/lib/route-params";
import { useNotesContext } from "../state/notes-context";
import { ConfirmDialog } from "./controls";
import { KeepImportDialog } from "./keep-import";

function LabelRow({ label }: { label: string }) {
  const { store, refresh, labels, persistLabels } = useNotesContext();
  const [name, setName] = useState(label);
  const [busy, setBusy] = useState(false);
  const [merging, setMerging] = useState(false);
  const edit = async (remove: boolean) => {
    setBusy(true);
    try {
      const failed = await (remove
        ? store.deleteLabelEverywhere(label)
        : store.renameLabelEverywhere(label, name.trim()));
      if (failed.length)
        toast.error(`Couldn't update the label on ${failed.length} notes. Try again.`);
      else
        persistLabels(
          remove
            ? labels.filter((item) => item !== label)
            : [...new Set(labels.map((item) => (item === label ? name.trim() : item)))],
        );
      await refresh();
    } catch {
      toast.error("Couldn't update this label. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <form
        className="notes-label-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (labels.includes(name.trim())) setMerging(true);
          else void edit(false);
        }}
      >
        <Tag size={16} aria-hidden="true" />
        <Input
          disabled={busy || merging}
          aria-label={`Rename ${label}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          type="submit"
          variant="ghost"
          disabled={busy || !name.trim() || name.trim() === label}
        >
          Rename
        </Button>
        <IconButton
          label={`Delete label ${label}`}
          variant="ghost"
          disabled={busy}
          onClick={() => void edit(true)}
        >
          <Trash2 size={16} aria-hidden="true" />
        </IconButton>
      </form>
      {merging && (
        <ConfirmDialog
          title={`Merge “${label}” into “${name.trim()}”?`}
          description="Notes with either label will use the destination label."
          confirm={() => edit(false)}
          close={() => setMerging(false)}
        />
      )}
    </>
  );
}
export function NotesSidebar() {
  const { labels, persistLabels } = useNotesContext();
  const pathname = useRoutePathname();
  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [name, setName] = useState("");
  const destinations = [
    { href: "/notes", label: "Notes", icon: StickyNote },
    { href: "/notes/search", label: "Search", icon: Search },
    { href: "/notes/reminders", label: "Reminders", icon: Bell },
    ...labels.map((label) => ({
      href: `/notes/label/${encodeURIComponent(label)}`,
      label,
      icon: Tag,
    })),
  ];
  return (
    <div className="notes-sidebar">
      <h2>
        <StickyNote size={26} aria-hidden="true" />
        Notes
      </h2>
      <nav aria-label="Notes folders">
        {destinations.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={
              pathname === href || (href === "/notes" && pathname.startsWith("/notes/n/"))
                ? "page"
                : undefined
            }
          >
            <Icon size={19} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
        <Button variant="ghost" onClick={() => setEditing(true)}>
          <Pencil size={18} aria-hidden="true" />
          Edit labels
        </Button>
        <hr />
        {[
          { href: "/notes/archive", label: "Archive", icon: Archive },
          { href: "/notes/trash", label: "Trash", icon: Trash2 },
        ].map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>
            <Icon size={19} aria-hidden="true" />
            {label}
          </Link>
        ))}
        <Button variant="ghost" onClick={() => setImporting(true)}>
          <Import size={18} aria-hidden="true" />
          Import from Keep
        </Button>
      </nav>
      {importing && <KeepImportDialog open close={() => setImporting(false)} />}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="notes-edit-labels">
          <DialogTitle>Edit labels</DialogTitle>
          <DialogDescription>
            Organise your notes. Deleting a label keeps its notes.
          </DialogDescription>
          <div className="notes-label-editor">
            {labels.map((label) => (
              <LabelRow key={label} label={label} />
            ))}
          </div>
          <form
            className="notes-new-label"
            onSubmit={(event) => {
              event.preventDefault();
              const label = name.trim();
              if (label) persistLabels([...new Set([...labels, label])]);
              setName("");
            }}
          >
            <Input
              aria-label="Create label"
              placeholder="New label"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" disabled={!name.trim()}>
              Create
            </Button>
          </form>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Done
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
