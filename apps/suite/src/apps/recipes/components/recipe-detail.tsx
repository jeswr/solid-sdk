// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { formatDuration, type RecipeRecord, scaleIngredient } from "@jeswr/solid-recipe";
import { Button, Checkbox, IconButton, Label } from "@jeswr/suite-ui";
import { ArrowLeft, Heart } from "lucide-react";
import { useEffect, useState } from "react";

export function RecipeDetail({
  record,
  disabled,
  onBack,
  onEdit,
  onFavourite,
}: {
  record: RecipeRecord;
  disabled: boolean;
  onBack: () => void;
  onEdit: () => void;
  onFavourite: () => void;
}) {
  const recipe = record.data;
  const [cook, setCook] = useState(false);
  const [factor, setFactor] = useState("1");
  const [awake, setAwake] = useState(false);
  const [wakeStatus, setWakeStatus] = useState("");
  useEffect(() => {
    if (!cook || !awake) return;
    if (!("wakeLock" in navigator)) {
      setWakeStatus("Keep awake is not available in this browser.");
      return;
    }
    let live = true;
    let lock: WakeLockSentinel | undefined;
    let requesting = false;
    const request = async () => {
      if (requesting || document.visibilityState !== "visible" || (lock && !lock.released)) return;
      requesting = true;
      try {
        const acquired = await navigator.wakeLock.request("screen");
        if (!live) {
          await acquired.release();
          return;
        }
        lock = acquired;
        setWakeStatus("Your screen will stay awake while this page is visible.");
        acquired.addEventListener("release", () => {
          if (live) setWakeStatus("Screen awake paused. Keep this page visible to resume.");
        });
      } catch {
        if (live) setWakeStatus("Couldn't keep the screen awake. You can still use cook mode.");
      } finally {
        requesting = false;
      }
    };
    void request();
    document.addEventListener("visibilitychange", request);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", request);
      void lock?.release().catch(() => {});
    };
  }, [awake, cook]);
  return (
    <article className={`recipes-detail ${cook ? "recipes-cooking" : ""}`}>
      <div className="recipes-actions">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" />
          Recipe box
        </Button>
        <Button variant="outline" onClick={onEdit} disabled={disabled}>
          Edit recipe
        </Button>
        <IconButton
          label={recipe.favourite ? "Remove from favourites" : "Add to favourites"}
          aria-pressed={recipe.favourite ?? false}
          onClick={onFavourite}
          disabled={disabled}
        >
          <Heart aria-hidden="true" fill={recipe.favourite ? "currentColor" : "none"} />
        </IconButton>
      </div>
      <p className="recipes-eyebrow">
        {[recipe.category, recipe.cuisine].filter(Boolean).join(" · ") || "From your recipe box"}
      </p>
      <h2>{recipe.name}</h2>
      <p className="recipes-description">{recipe.description}</p>
      <div className="recipes-meta">
        <span>
          {recipe.recipeYield
            ? scaleIngredient(recipe.recipeYield, Number(factor))
            : "Yield not specified"}
        </span>
        {recipe.totalTime && <span>{formatDuration(recipe.totalTime)}</span>}
        {recipe.rating !== undefined && <span>Personal rating: {recipe.rating}/5</span>}
        {recipe.calories && <span>{recipe.calories}</span>}
      </div>
      {(recipe.prepTime || recipe.cookTime) && (
        <p className="recipes-muted">
          {recipe.prepTime && `Prep ${formatDuration(recipe.prepTime)}`}
          {recipe.prepTime && recipe.cookTime && " · "}
          {recipe.cookTime && `Cook ${formatDuration(recipe.cookTime)}`}
        </p>
      )}
      <div className="recipes-actions">
        <Button aria-pressed={cook} onClick={() => setCook((value) => !value)}>
          {cook ? "Leave cook mode" : "Start cooking"}
        </Button>
        {cook && (
          <>
            <Checkbox
              id="recipe-awake"
              checked={awake}
              onCheckedChange={(value) => setAwake(value === true)}
            />
            <Label htmlFor="recipe-awake">Keep screen awake</Label>
          </>
        )}
      </div>
      {cook && awake && (
        <p role="status" className="recipes-muted">
          {wakeStatus}
        </p>
      )}
      <div className="recipes-columns">
        <section aria-labelledby="recipe-ingredient-heading">
          <div className="recipes-section-heading">
            <h3 id="recipe-ingredient-heading">Ingredients</h3>
            <Label htmlFor="recipe-scale">Scale recipe</Label>
            <select
              id="recipe-scale"
              value={factor}
              onChange={(event) => setFactor(event.target.value)}
            >
              <option value="0.5">½×</option>
              <option value="1">1×</option>
              <option value="1.5">1½×</option>
              <option value="2">2×</option>
              <option value="3">3×</option>
            </select>
          </div>
          {recipe.ingredients.length === 0 && (
            <p className="recipes-muted">No ingredients added yet.</p>
          )}
          <ul className="recipes-checklist">
            {recipe.ingredients.map((ingredient, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positions distinguish duplicate ingredients; changed text resets its checkbox.
              <li key={`${index}:${ingredient}`}>
                <Checkbox id={`ingredient-${index}`} />
                <Label htmlFor={`ingredient-${index}`}>
                  {scaleIngredient(ingredient, Number(factor))}
                </Label>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="recipe-method-heading">
          <h3 id="recipe-method-heading">Method</h3>
          {!recipe.instructions.length && <p className="recipes-muted">No steps added yet.</p>}
          <ol className="recipes-checklist recipes-steps">
            {recipe.instructions.map((step, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positions distinguish duplicate steps; changed text resets its checkbox.
              <li key={`${index}:${step}`}>
                <span className="recipes-step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <Checkbox id={`step-${index}`} />
                <Label htmlFor={`step-${index}`}>
                  <span className="sr-only">Step {index + 1}: </span>
                  {step}
                </Label>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <footer className="recipes-source">
        {recipe.author && <p>Recipe by {recipe.author}</p>}
        {recipe.url && (
          <a href={recipe.url} rel="noopener noreferrer" target="_blank">
            View original recipe
          </a>
        )}
        {recipe.modified && (
          <p className="recipes-muted">
            Last updated {recipe.modified.toLocaleDateString("en-GB")}
          </p>
        )}
      </footer>
    </article>
  );
}
