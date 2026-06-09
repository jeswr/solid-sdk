"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { resolveTracker, type TrackerLocation } from "@/lib/profile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Loader2 } from "lucide-react";

const schema = z.object({
  webId: z
    .string()
    .trim()
    .min(1, "Enter a WebID")
    .refine((v) => /^https?:\/\//.test(v), "Must be a WebID (http(s) URL)"),
});
type FormValues = z.infer<typeof schema>;

export function OpenTrackerDialog({
  open,
  onOpenChange,
  onOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: (tracker: TrackerLocation) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { webId: "" } });

  const submit = async (values: FormValues) => {
    setError(null);
    try {
      const tracker = await resolveTracker(values.webId.trim());
      onOpen(tracker);
      onOpenChange(false);
      form.reset({ webId: "" });
    } catch (e) {
      setError(
        e instanceof Error
          ? `Couldn't open that tracker: ${e.message}`
          : "Couldn't open that tracker.",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Open someone&apos;s tracker</DialogTitle>
          <DialogDescription>
            Enter a person&apos;s WebID to open a tracker they&apos;ve shared with you.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(submit)} className="space-y-3" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="open-webid">Their WebID</Label>
            <Input
              id="open-webid"
              type="url"
              autoFocus
              placeholder="https://…/profile/card#me"
              aria-invalid={!!form.formState.errors.webId}
              {...form.register("webId")}
            />
            {form.formState.errors.webId && (
              <p className="text-sm text-destructive">{form.formState.errors.webId.message}</p>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Open tracker
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
