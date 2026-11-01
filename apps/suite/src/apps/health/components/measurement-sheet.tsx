// AUTHORED-BY Codex GPT-6
"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Textarea,
} from "@jeswr/suite-ui";
import { DateTimeField, type DateTimeValue } from "@jeswr/suite-ui/date-time";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { CATALOGUE, type MetricId } from "../lib/data/metrics";
import { useHealth } from "../state/health-context";

const schema = z
  .object({
    metric: z.enum(["steps", "heartRate", "sleep", "weight", "blood-pressure"]),
    value: z
      .string()
      .refine(
        (value) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) > 0,
        "Enter a positive number",
      ),
    second: z.string(),
    unit: z.string(),
    at: z.string().refine((value) => Number.isFinite(Date.parse(value)), "Choose a date and time"),
    note: z.string().max(2000, "Keep notes under 2,000 characters"),
  })
  .superRefine((value, context) => {
    if (value.metric === "steps" && !Number.isInteger(Number(value.value)))
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Enter a whole number of steps",
      });
    if (
      value.metric === "blood-pressure" &&
      (!value.second.trim() || !Number.isFinite(Number(value.second)) || Number(value.second) <= 0)
    )
      context.addIssue({
        code: "custom",
        path: ["second"],
        message: "Enter a positive diastolic value",
      });
  });
type Fields = z.infer<typeof schema>;
const UNITS: Record<MetricId, { code: string; label: string }[]> = {
  steps: [{ code: "1", label: "steps" }],
  heartRate: [{ code: "/min", label: "bpm" }],
  sleep: [
    { code: "h", label: "hours" },
    { code: "min", label: "minutes" },
  ],
  weight: [
    { code: "kg", label: "kg" },
    { code: "lb", label: "lb" },
  ],
  "blood-pressure": [{ code: "mmHg", label: "mmHg" }],
};
export function useSheetSide() {
  const [side, setSide] = useState<"bottom" | "right">("right");
  useEffect(() => {
    const media = matchMedia("(max-width: 767px)");
    const update = () => setSide(media.matches ? "bottom" : "right");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return side;
}
export function MeasurementSheet({
  metric,
  onClose,
}: {
  metric: MetricId | null;
  onClose(): void;
}) {
  const { add } = useHealth();
  const side = useSheetSide();
  const trigger = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const operationId = useRef("");
  const form = useForm<Fields>({
    resolver: zodResolver(schema),
    defaultValues: {
      metric: metric ?? "weight",
      value: "",
      second: "",
      unit: "kg",
      at: new Date().toISOString(),
      note: "",
    },
  });
  const selected = form.watch("metric");
  const [error, setError] = useState("");
  const { reset, setValue } = form;
  useEffect(() => {
    generation.current++;
    if (metric) {
      operationId.current = crypto.randomUUID();
      reset({
        metric,
        value: "",
        second: "",
        unit: UNITS[metric][0]?.code ?? "",
        at: new Date().toISOString(),
        note: "",
      });
      setError("");
    }
  }, [metric, reset]);
  useEffect(() => {
    setValue("unit", UNITS[selected][0]?.code ?? "");
  }, [selected, setValue]);
  return (
    <Sheet
      open={metric !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
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
        <SheetTitle>Add measurement</SheetTitle>
        <SheetDescription>Save a reading to your private Health records.</SheetDescription>
        <form
          className="hlt-form"
          onSubmit={form.handleSubmit(async (values) => {
            const request = generation.current;
            setError("");
            try {
              if (values.metric === "blood-pressure") {
                await add(
                  "blood-pressure",
                  Number(values.value),
                  values.unit,
                  new Date(values.at),
                  values.note,
                  Number(values.second),
                  operationId.current,
                );
              } else
                await add(
                  values.metric,
                  Number(values.value),
                  values.unit,
                  new Date(values.at),
                  values.note,
                  undefined,
                  operationId.current,
                );
              if (request === generation.current) onClose();
            } catch {
              if (request !== generation.current) return;
              setError(
                "Couldn't save this measurement. Check your connection and try again. Your storage must allow private Health records.",
              );
            }
          })}
        >
          <label htmlFor="hlt-metric">Metric</label>
          <select id="hlt-metric" {...form.register("metric")}>
            {CATALOGUE.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <label htmlFor="hlt-value">{selected === "blood-pressure" ? "Systolic" : "Value"}</label>
          <Input
            id="hlt-value"
            inputMode="decimal"
            {...form.register("value")}
            aria-invalid={!!form.formState.errors.value}
            aria-describedby="hlt-value-error"
          />
          <p id="hlt-value-error" role="alert">
            {form.formState.errors.value?.message}
          </p>
          {selected === "blood-pressure" && (
            <>
              <label htmlFor="hlt-second">Diastolic</label>
              <Input
                id="hlt-second"
                inputMode="decimal"
                {...form.register("second")}
                aria-invalid={!!form.formState.errors.second}
                aria-describedby="hlt-second-error"
              />
              <p id="hlt-second-error" role="alert">
                {form.formState.errors.second?.message}
              </p>
            </>
          )}
          <label htmlFor="hlt-unit">Unit</label>
          <select id="hlt-unit" {...form.register("unit")}>
            {UNITS[selected].map((unit) => (
              <option key={unit.code} value={unit.code}>
                {unit.label}
              </option>
            ))}
          </select>
          <Controller
            control={form.control}
            name="at"
            render={({ field }) => (
              <DateTimeField
                label="Date and time"
                locale="en-GB"
                value={field.value ? { kind: "dateTime", dateTime: field.value } : null}
                onChange={(value: DateTimeValue | null) =>
                  field.onChange(
                    value?.kind === "dateTime"
                      ? value.dateTime
                      : value?.kind === "date"
                        ? `${value.date}T12:00:00.000Z`
                        : "",
                  )
                }
              />
            )}
          />
          <p role="alert">{form.formState.errors.at?.message}</p>
          <label htmlFor="hlt-note">Note (optional)</label>
          <Textarea id="hlt-note" {...form.register("note")} aria-describedby="hlt-note-error" />
          <p id="hlt-note-error" role="alert">
            {form.formState.errors.note?.message}
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="hlt-form-actions">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Saving…" : "Save measurement"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
