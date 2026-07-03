// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The scanned-product view (DESIGN §5.2): product identity, the derived trigger
 * exposures (with the honest "possible undeclared" note), the OFF data-quality
 * caveat + ODbL attribution (shown on EVERY product view, never a bare green
 * tick), and the one-tap "Ate it now" action. Context/portion default and are
 * one-tap to change; nothing else is required (5-second path).
 */
import {
  deriveExposures,
  type MealContext,
  MEAL_CONTEXTS,
} from "@jeswr/solid-health-diary";
import { useMemo, useState } from "react";
import { dataQualityNote, exposureDisplay, triggerLabel } from "@/lib/off/exposure-display";
import { offProductToFoodItem, type OffProduct } from "@/lib/off/off";
import { useDiaryActions } from "@/lib/session/use-diary-actions";

type Phase = "idle" | "saving" | "saved" | "error";

export function ProductView({
  product,
  source = "off",
  onLogged,
}: {
  product: OffProduct;
  source?: "off" | "cache";
  onLogged?: () => void;
}) {
  const { logMeal } = useDiaryActions();
  const [context, setContext] = useState<MealContext>("home");
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const foodItem = useMemo(() => offProductToFoodItem(product), [product]);
  const exposures = useMemo(() => deriveExposures([foodItem]), [foodItem]);

  async function ateItNow() {
    setPhase("saving");
    setErrorMsg(null);
    try {
      const { syncing } = await logMeal({ items: [foodItem], context, exposures });
      setPhase("saved"); // optimistic — the record is already cached
      onLogged?.();
      await syncing;
    } catch (err) {
      setPhase("error");
      setErrorMsg((err as Error).message);
    }
  }

  return (
    <article className="product" aria-labelledby="product-name">
      <header className="product__head">
        <h2 id="product-name">{product.name ?? `Barcode ${product.barcode}`}</h2>
        {product.brands ? <p className="product__brands">{product.brands}</p> : null}
        {product.quantity ? <p className="product__qty">{product.quantity}</p> : null}
      </header>

      <section aria-label="Detected triggers" className="product__exposures">
        {exposures.length === 0 ? (
          <p className="exposure exposure--info">
            No tracked triggers detected in this product&rsquo;s data. This is not an
            all-clear — always verify against the packet.
          </p>
        ) : (
          <ul className="exposure-list">
            {exposures.map((e) => {
              const d = exposureDisplay(e.exposureLevel);
              return (
                <li key={e.trigger} className={`exposure exposure--${d.tone}`}>
                  <span className="exposure__level">{d.label}</span>{" "}
                  <span className="exposure__trigger">{triggerLabel(e.trigger)}</span>
                  {e.note ? <p className="exposure__note">{e.note}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="product__quality" role="note">
        {dataQualityNote(product)}
      </p>

      <div className="product__log">
        <label className="product__context">
          Where?
          <select
            value={context}
            onChange={(e) => setContext(e.target.value as MealContext)}
            aria-label="Where did you eat this?"
          >
            {MEAL_CONTEXTS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn--primary"
          onClick={ateItNow}
          disabled={phase === "saving"}
        >
          {phase === "saving" ? "Saving…" : phase === "saved" ? "Saved ✓ — log again?" : "Ate it now"}
        </button>
        <span aria-live="polite" className="product__status">
          {phase === "saved" ? "Saved to your pod" : phase === "error" ? `Couldn't sync: ${errorMsg} (will retry)` : ""}
        </span>
      </div>

      <footer className="product__attribution">
        <a href={product.sourceUrl} target="_blank" rel="noopener noreferrer">
          Product data from Open Food Facts
        </a>{" "}
        — © Open Food Facts contributors, ODbL{source === "cache" ? " (cached — offline)" : ""}.
      </footer>
    </article>
  );
}
