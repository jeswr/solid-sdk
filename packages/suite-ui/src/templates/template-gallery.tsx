// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useId, useState } from "react";
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
        <ul
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
          {filtered.map((item) => (
            <li key={item.id} className="su-template-card">
              <button
                type="button"
                data-template-choice
                disabled={busy}
                onClick={() => onChoose(item)}
                aria-label={`Use ${item.name}`}
              >
                {item.previewImage && /^https?:\/\//.test(item.previewImage) ? (
                  // biome-ignore lint/performance/noImgElement: pod-owned preview URLs cannot use a Next image proxy
                  <img src={item.previewImage} alt="" loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <span className="su-template-preview" aria-hidden="true">
                    {item.previewText || item.description}
                  </span>
                )}
                <strong>{item.name}</strong>
                <span>{item.description}</span>
                <small>
                  {item.app} · {item.category} ·{" "}
                  {item.source === "user" ? "My templates" : "Built-in"}
                </small>
              </button>
              {item.source === "user" && onDelete && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onDelete(item)}
                  aria-label={`Delete template ${item.name}`}
                >
                  Delete
                </Button>
              )}
            </li>
          ))}
        </ul>
        {!filtered.length && !loading && <p>No templates match these filters.</p>}
      </DialogContent>
    </Dialog>
  );
}
