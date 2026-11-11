// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { isEmergencySymptomType, SYMPTOM_TYPES, type SymptomType } from "@jeswr/solid-health-diary";
import {
  Button,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Textarea,
} from "@jeswr/suite-ui";
import { useRef, useState } from "react";
import {
  type DiaryDraft,
  type DiaryEntry,
  MANUAL_EXPOSURE_NOTE,
  matchDiaryItems,
} from "../lib/data/diary";
import { useDiaryActions } from "../state/diary-context";
import { useDiaryMode } from "../state/diary-mode-context";
import { useSheetSide } from "./measurement-sheet";

export function DiarySheet({
  kind,
  entry,
  onClose,
}: {
  kind: DiaryDraft["kind"];
  entry?: DiaryEntry;
  onClose(): void;
}) {
  const { save } = useDiaryActions();
  const mode = useDiaryMode();
  const selectedExposure =
    entry?.kind === "meal"
      ? entry.exposures?.find((value) => value.trigger === mode.trigger)
      : undefined;
  const [exposed, setExposed] = useState(
    !!selectedExposure && selectedExposure.exposureLevel !== "absent",
  );
  const [suspected, setSuspected] = useState(
    selectedExposure?.exposureLevel === "possible-undeclared",
  );
  const side = useSheetSide();
  const [id] = useState(() => crypto.randomUUID());
  const trigger = useRef<HTMLElement | null>(null);
  const [at, setAt] = useState(entry?.at.toISOString() ?? new Date().toISOString());
  const [foods, setFoods] = useState(entry?.kind === "meal" ? entry.foods.join("\n") : "");
  const [ingredientEdits, setIngredientEdits] = useState<Record<string, string>>({});
  const names = foods
    .split("\n")
    .map((food) => food.trim())
    .filter(Boolean);
  const items = matchDiaryItems(
    names,
    entry?.kind === "meal"
      ? (entry.items ??
          entry.foods.map((name, index) => ({
            name,
            ingredientsText: index === 0 ? entry.ingredients : "",
          })))
      : [],
  );
  const ingredients = items.map(
    (item, index) => ingredientEdits[item.id ?? `new-${index}`] ?? item.ingredientsText ?? "",
  );
  const [tags, setTags] = useState(entry?.kind === "meal" ? entry.tags.join(", ") : "");
  const [type, setType] = useState<SymptomType>(
    entry?.kind === "symptom" ? entry.symptomType : "bloating",
  );
  const [severity, setSeverity] = useState(
    String(entry?.kind === "symptom" ? (entry.severity ?? "") : ""),
  );
  const [duration, setDuration] = useState(
    entry?.kind === "symptom" && entry.durationMinutes !== null
      ? String(entry.durationMinutes)
      : "",
  );
  const [note, setNote] = useState(entry?.note ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const title = `${entry ? "Edit" : "Log"} ${kind}`;
  const errorProps = (field: string) => ({
    "aria-invalid": !!errors[field],
    "aria-describedby": `hlt-diary-${field}-error`,
  });
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <SheetContent
        className="hlt-sheet"
        side={side}
        onOpenAutoFocus={() => {
          trigger.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = trigger.current;
          (target?.isConnected ? target : document.getElementById("main-content"))?.focus();
        }}
      >
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>
          Save to your private Health diary. Times are shown in your local time zone.
        </SheetDescription>
        <form
          className="hlt-form"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            if (saving) return;
            const next: Record<string, string> = {};
            if (!Number.isFinite(Date.parse(at))) next.at = "Choose a date and time.";
            if (kind === "meal") {
              if (!foods.trim() || foods.length > 4000)
                next.foods = "Enter at least one food, up to 4,000 characters.";
              if (ingredients.filter(Boolean).join("\n").length > 4000)
                next.ingredients = "Keep ingredients under 4,000 characters.";
              if (tags.length > 1000) next.tags = "Keep tags under 1,000 characters.";
            } else {
              if (
                severity.trim() &&
                (!Number.isInteger(Number(severity)) ||
                  Number(severity) < 0 ||
                  Number(severity) > 10)
              )
                next.severity = "Enter a whole number from 0 to 10.";
              if (
                duration.trim() &&
                (!Number.isInteger(Number(duration)) ||
                  Number(duration) < 1 ||
                  Number(duration) > 525600)
              )
                next.duration = "Enter 1 to 525,600 minutes, or leave blank.";
            }
            if (note.length > 4000) next.note = "Keep notes under 4,000 characters.";
            setErrors(next);
            setFailure("");
            if (Object.keys(next).length) return;
            const common = { at: new Date(at), note };
            const draft: DiaryDraft =
              kind === "meal"
                ? {
                    ...common,
                    kind,
                    foods: names,
                    items,
                    exposures: mode.enabled
                      ? [
                          ...(entry?.kind === "meal"
                            ? (entry.exposures ?? []).filter(
                                (value) => value.trigger !== mode.trigger,
                              )
                            : []),
                          ...(exposed
                            ? [
                                {
                                  trigger: mode.trigger,
                                  exposureLevel: suspected
                                    ? ("possible-undeclared" as const)
                                    : ("present" as const),
                                  note: MANUAL_EXPOSURE_NOTE,
                                },
                              ]
                            : []),
                        ]
                      : entry?.kind === "meal"
                        ? (entry.exposures ?? [])
                        : [],
                    ingredients: ingredients.filter(Boolean).join("\n"),
                    itemIngredients: ingredients,
                    tags: [
                      ...new Set(
                        tags
                          .split(",")
                          .map((tag) => tag.trim())
                          .filter(Boolean),
                      ),
                    ],
                  }
                : {
                    ...common,
                    kind,
                    symptomType: type,
                    severity: severity.trim() ? Number(severity) : null,
                    durationMinutes: duration.trim() ? Number(duration) : null,
                  };
            setSaving(true);
            try {
              await save(draft, id, entry);
              onClose();
            } catch (error) {
              setFailure(
                typeof error === "object" &&
                  error !== null &&
                  "status" in error &&
                  error.status === 412
                  ? "This entry changed elsewhere. Close this form and review the refreshed entry before editing again."
                  : "Couldn't save your diary entry. Your draft is still here; check your connection and try again.",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          <label htmlFor="hlt-diary-at">Date and time</label>
          <Input
            id="hlt-diary-at"
            type="datetime-local"
            step="0.001"
            value={
              at
                ? new Date(new Date(at).getTime() - new Date(at).getTimezoneOffset() * 60000)
                    .toISOString()
                    .slice(0, -1)
                : ""
            }
            onChange={(event) =>
              setAt(event.target.value ? new Date(event.target.value).toISOString() : "")
            }
            {...errorProps("at")}
          />
          <p id="hlt-diary-at-error" role="alert">
            {errors.at}
          </p>
          {kind === "meal" ? (
            <>
              <label htmlFor="hlt-diary-foods">Foods (one per line)</label>
              <Textarea
                id="hlt-diary-foods"
                value={foods}
                onChange={(event) => setFoods(event.target.value)}
                {...errorProps("foods")}
              />
              <p id="hlt-diary-foods-error" role="alert">
                {errors.foods}
              </p>
              {items.map((item, index) => (
                <div key={item.id ?? `new-${index}`}>
                  <label htmlFor={`hlt-diary-ingredients-${index}`}>
                    {items.length === 1
                      ? "Ingredients (optional)"
                      : `Ingredients for ${item.name} (optional)`}
                  </label>
                  <Textarea
                    id={`hlt-diary-ingredients-${index}`}
                    value={ingredients[index]}
                    onChange={(event) =>
                      setIngredientEdits((current) => ({
                        ...current,
                        [item.id ?? `new-${index}`]: event.target.value,
                      }))
                    }
                    {...errorProps("ingredients")}
                  />
                </div>
              ))}
              <p id="hlt-diary-ingredients-error" role="alert">
                {errors.ingredients}
              </p>
              {mode.enabled && (
                <fieldset>
                  <legend>Food intolerance exposure</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={exposed}
                      onChange={(event) => setExposed(event.target.checked)}
                    />{" "}
                    Contains {mode.trigger}
                  </label>
                  {exposed && (
                    <label>
                      <input
                        type="checkbox"
                        checked={suspected}
                        onChange={(event) => setSuspected(event.target.checked)}
                      />{" "}
                      Suspected exposure
                    </label>
                  )}
                  <p className="hlt-muted">
                    Leave unchecked when no exposure was logged. Check ingredients and the packet
                    for allergens.
                  </p>
                </fieldset>
              )}
              <label htmlFor="hlt-diary-tags">Tags (comma separated, optional)</label>
              <Input
                id="hlt-diary-tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                {...errorProps("tags")}
              />
              <p id="hlt-diary-tags-error" role="alert">
                {errors.tags}
              </p>
            </>
          ) : (
            <>
              <label htmlFor="hlt-diary-type">Symptom type</label>
              <select
                id="hlt-diary-type"
                value={type}
                onChange={(event) => setType(event.target.value as SymptomType)}
              >
                {SYMPTOM_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("-", " ")}
                  </option>
                ))}
              </select>
              {isEmergencySymptomType(type) && (
                <p role="alert">
                  If you are having trouble breathing or a severe allergic reaction, seek urgent
                  medical help now. Logging a symptom does not request help.
                </p>
              )}
              <label htmlFor="hlt-diary-severity">Severity (0 = none, 10 = worst)</label>
              <select
                id="hlt-diary-severity"
                value={severity}
                onChange={(event) => setSeverity(event.target.value)}
                {...errorProps("severity")}
              >
                <option value="">Not recorded</option>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <p id="hlt-diary-severity-error" role="alert">
                {errors.severity}
              </p>
              <label htmlFor="hlt-diary-duration">Duration in minutes (optional)</label>
              <Input
                id="hlt-diary-duration"
                type="number"
                min={1}
                max={525600}
                step={1}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                {...errorProps("duration")}
              />
              <p id="hlt-diary-duration-error" role="alert">
                {errors.duration}
              </p>
            </>
          )}
          <label htmlFor="hlt-diary-note">Notes (optional)</label>
          <Textarea
            id="hlt-diary-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            {...errorProps("note")}
          />
          <p id="hlt-diary-note-error" role="alert">
            {errors.note}
          </p>
          {failure && <p role="alert">{failure}</p>}
          <div className="hlt-form-actions">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : `Save ${kind}`}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
