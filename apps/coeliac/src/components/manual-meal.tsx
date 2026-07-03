// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Manual meal entry (DESIGN §5.1) — the fallback when a barcode misses or a meal
 * isn't packaged. Add one or more food items by name, pick where you ate it, tap
 * "Ate it now". Optimistic write with a "Saving…/Saved" indicator; no mandatory
 * fields beyond a name.
 */
"use client";
import { type MealContext, MEAL_CONTEXTS } from "@jeswr/solid-health-diary";
import { useState } from "react";
import { useDiaryActions } from "@/lib/session/use-diary-actions";

type Phase = "idle" | "saving" | "saved" | "error";

export function ManualMeal({
  onLogged,
  initialName = "",
}: {
  onLogged?: () => void;
  initialName?: string;
}) {
  const { logMeal } = useDiaryActions();
  const [items, setItems] = useState<string[]>(initialName ? [initialName] : []);
  const [draft, setDraft] = useState("");
  const [context, setContext] = useState<MealContext>("home");
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function addDraft() {
    const name = draft.trim();
    if (!name) return;
    setItems((xs) => [...xs, name]);
    setDraft("");
  }

  async function log() {
    const names = draft.trim() ? [...items, draft.trim()] : items;
    if (names.length === 0) return;
    setPhase("saving");
    setErrorMsg(null);
    try {
      const { syncing } = await logMeal({
        items: names.map((name) => ({ name, sourceConfidence: "manual" as const })),
        context,
      });
      setPhase("saved");
      setItems([]);
      setDraft("");
      onLogged?.();
      await syncing;
    } catch (err) {
      setPhase("error");
      setErrorMsg((err as Error).message);
    }
  }

  return (
    <form
      className="manual-meal"
      aria-label="Log a meal by hand"
      onSubmit={(e) => {
        e.preventDefault();
        void log();
      }}
    >
      {items.length > 0 ? (
        <ul className="manual-meal__items">
          {items.map((name, i) => (
            <li key={`${name}-${i}`}>
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="manual-meal__add">
        <label htmlFor="item-name">Food / drink</label>
        <input
          id="item-name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. porridge with oat milk"
        />
        <button type="button" className="btn" onClick={addDraft} disabled={!draft.trim()}>
          Add another
        </button>
      </div>
      <label className="manual-meal__context">
        Where?
        <select value={context} onChange={(e) => setContext(e.target.value as MealContext)}>
          {MEAL_CONTEXTS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="btn btn--primary"
        disabled={phase === "saving" || (items.length === 0 && !draft.trim())}
      >
        {phase === "saving" ? "Saving…" : phase === "saved" ? "Saved ✓" : "Ate it now"}
      </button>
      <span aria-live="polite" className="manual-meal__status">
        {phase === "saved" ? "Saved to your pod" : phase === "error" ? `Couldn't sync: ${errorMsg} (will retry)` : ""}
      </span>
    </form>
  );
}
