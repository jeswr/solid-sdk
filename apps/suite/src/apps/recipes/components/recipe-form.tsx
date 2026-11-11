// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { durationMinutes, type RecipeData } from "@jeswr/solid-recipe";
import {
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@jeswr/suite-ui";
import { useState } from "react";
import { recipeFromForm } from "../lib/recipes";

export function RecipeForm({
  initial,
  disabled,
  onClose,
  onSave,
}: {
  initial?: RecipeData | undefined;
  disabled: boolean;
  onClose: () => void;
  onSave: (data: RecipeData) => void;
}) {
  const [error, setError] = useState("");
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="recipes-sheet" side="right">
        <SheetHeader>
          <SheetTitle>{initial ? "Edit recipe" : "New recipe"}</SheetTitle>
          <SheetDescription>
            Make it your own. Ingredients and steps go on separate lines.
          </SheetDescription>
        </SheetHeader>
        <form
          className="recipes-form"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              onSave(recipeFromForm(new FormData(event.currentTarget), initial));
            } catch (error) {
              setError(error instanceof Error ? error.message : "Check your recipe");
            }
          }}
        >
          {error && <p role="alert">{error}</p>}
          <Label htmlFor="recipe-name">Recipe name</Label>
          <Input id="recipe-name" name="name" required defaultValue={initial?.name} autoFocus />
          <Label htmlFor="recipe-description">Description</Label>
          <Textarea
            id="recipe-description"
            name="description"
            defaultValue={initial?.description}
          />
          <div className="recipes-fields">
            {(
              [
                ["category", "Category", "text"],
                ["cuisine", "Cuisine", "text"],
                ["recipeYield", "Yield (e.g. 4 servings)", "text"],
                ["author", "Author", "text"],
                ["prepTime", "Prep time (minutes)", "number"],
                ["cookTime", "Cook time (minutes)", "number"],
                ["totalTime", "Total time (minutes)", "number"],
                ["calories", "Calories per serving", "text"],
                ["rating", "Personal rating (0–5)", "number"],
                ["url", "Source URL", "url"],
                ["image", "Image URL", "url"],
              ] as const
            ).map(([name, label, type]) => (
              <div key={name}>
                <Label htmlFor={`recipe-${name}`}>{label}</Label>
                <Input
                  id={`recipe-${name}`}
                  name={name}
                  type={type}
                  min={type === "number" ? 0 : undefined}
                  max={name === "rating" ? 5 : undefined}
                  step={type === "number" ? (name === "rating" ? 0.5 : "any") : undefined}
                  defaultValue={
                    name === "prepTime" || name === "cookTime" || name === "totalTime"
                      ? durationMinutes(initial?.[name] ?? "")
                      : initial?.[name]
                  }
                />
              </div>
            ))}
          </div>
          <Label htmlFor="recipe-keywords">Tags, separated by commas</Label>
          <Input
            id="recipe-keywords"
            name="keywords"
            defaultValue={initial?.keywords?.join(", ")}
          />
          <Label htmlFor="recipe-ingredients">Ingredients (one per line)</Label>
          <Textarea
            id="recipe-ingredients"
            name="ingredients"
            rows={7}
            defaultValue={initial?.ingredients.join("\n")}
          />
          <Label htmlFor="recipe-instructions">Method (one step per line)</Label>
          <Textarea
            id="recipe-instructions"
            name="instructions"
            rows={8}
            defaultValue={initial?.instructions.join("\n")}
          />
          {disabled && (
            <p role="status">
              You're offline. Keep this form open and reconnect to save your recipe.
            </p>
          )}
          <div className="recipes-actions">
            <Button type="submit" disabled={disabled}>
              Save recipe
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
