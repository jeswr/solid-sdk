// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog.js";
export interface TemplateGalleryItem {
  id: string;
  name: string;
  description?: string | undefined;
  category: string;
  previewText?: string | undefined;
  previewImage?: string | undefined;
  source: "builtin" | "user";
  app?: string | undefined;
}
export interface TemplateGalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly TemplateGalleryItem[];
  onChoose: (item: TemplateGalleryItem) => void;
  onDelete?: ((item: TemplateGalleryItem) => void) | undefined;
  loading?: boolean;
  busy?: boolean;
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
}
export function TemplateGallery({
  open,
  onOpenChange,
  items,
  onChoose,
  onDelete,
  loading,
  busy,
  error,
  onRetry,
}: TemplateGalleryProps) {
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("all");
  const id = useId();
  const [pendingDelete, setPendingDelete] = useState<string>();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const removed = useRef<{ id: string; index: number } | undefined>(undefined);
  useEffect(() => {
    if (pendingDelete) confirmRef.current?.focus();
  }, [pendingDelete]);
  useEffect(() => {
    const previous = removed.current;
    if (busy || !previous || items.some((item) => item.id === previous.id)) return;
    const choices = gridRef.current?.querySelectorAll<HTMLButtonElement>("[data-template-choice]");
    (choices?.[Math.min(previous.index, choices.length - 1)] ?? categoryRef.current)?.focus();
    removed.current = undefined;
  }, [items, busy]);
  const categories = [...new Set(items.map((item) => item.category))].sort();
  const filtered = items.filter(
    (item) =>
      (category === "" || category === item.category) &&
      (source === "all" || item.source === source),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <DialogContent className="su-template-dialog">
        <DialogTitle>New from template</DialogTitle>
        <DialogDescription>Choose a starting point for your next idea.</DialogDescription>
        <div className="su-template-filters">
          <label htmlFor={`${id}-category`}>
            Category
            <select
              ref={categoryRef}
              id={`${id}-category`}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label htmlFor={`${id}-source`}>
            Template source
            <select
              id={`${id}-source`}
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="all">All templates</option>
              <option value="builtin">Built-in templates</option>
              <option value="user">My templates</option>
            </select>
          </label>
        </div>
        {loading && <p role="status">Loading your templates…</p>}
        {error && (
          <div role="alert">
            {error}{" "}
            {onRetry && (
              <Button variant="outline" disabled={busy} onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
        )}
        {busy && <p role="status">Preparing your template…</p>}
        <span id={`${id}-use`} className="sr-only">
          Use
        </span>
        <ul
          ref={gridRef}
          className="su-template-grid"
          aria-label="Templates"
          onKeyDown={(event) => {
            if (
              !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(
                event.key,
              )
            )
              return;
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "[data-template-choice]:not(:disabled)",
              ),
            ];
            const index = buttons.indexOf(event.target as HTMLButtonElement);
            if (index < 0) return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (index +
                      (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) +
                      buttons.length) %
                    buttons.length;
            buttons[next]?.focus();
          }}
        >
          {filtered.map((item, index) => (
            <li key={item.id} className="su-template-card">
              <button
                type="button"
                data-template-choice
                disabled={busy}
                onClick={() => onChoose(item)}
                aria-labelledby={`${id}-use ${id}-title-${index}`}
                aria-describedby={`${id}-preview-${index} ${id}-description-${index}`}
              >
                {item.previewImage && /^https?:\/\//.test(item.previewImage) ? (
                  // biome-ignore lint/performance/noImgElement: pod-owned preview URLs cannot use a Next image proxy
                  <img src={item.previewImage} alt="" loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <span id={`${id}-preview-${index}`} className="su-template-preview">
                    {item.previewText || item.description}
                  </span>
                )}
                <strong id={`${id}-title-${index}`}>{item.name}</strong>
                <span id={`${id}-description-${index}`}>
                  <span>{item.description}</span>
                  <small>
                    {item.app} · {item.category} ·{" "}
                    {item.source === "user" ? "My templates" : "Built-in"}
                  </small>
                </span>
              </button>
              {item.source === "user" && onDelete && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={(event) => {
                    deleteTrigger.current = event.currentTarget;
                    setPendingDelete(item.id);
                  }}
                  aria-label={`Delete template ${item.name}`}
                >
                  Delete
                </Button>
              )}
              {pendingDelete === item.id && onDelete && (
                <fieldset aria-label={`Confirm deletion of ${item.name}`}>
                  <p>Delete this template? Documents already created from it will be kept.</p>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setPendingDelete(undefined);
                      deleteTrigger.current?.focus();
                    }}
                  >
                    Cancel deletion
                  </Button>
                  <Button
                    ref={confirmRef}
                    disabled={busy}
                    onClick={() => {
                      removed.current = { id: item.id, index };
                      setPendingDelete(undefined);
                      onDelete(item);
                    }}
                  >
                    Confirm delete
                  </Button>
                </fieldset>
              )}
            </li>
          ))}
        </ul>
        {!filtered.length && !loading && <p>No templates match these filters.</p>}
      </DialogContent>
    </Dialog>
  );
}
