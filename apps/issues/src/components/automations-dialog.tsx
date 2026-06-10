"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Zap } from "lucide-react";
import {
  AUTOMATION_DEFS,
  loadAutomationSettings,
  saveAutomationSettings,
  type AutomationSettings,
} from "@/lib/automations";

/** Toggle the built-in automations; persisted on this device. */
export function AutomationsDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (settings: AutomationSettings) => void;
}) {
  const [settings, setSettings] = useState<AutomationSettings>(loadAutomationSettings);

  useEffect(() => {
    // Reload persisted settings when reopened (another tab may have changed them).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setSettings(loadAutomationSettings());
  }, [open]);

  const toggle = (key: keyof AutomationSettings, value: boolean) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveAutomationSettings(next);
    onChanged(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="size-4 text-primary" aria-hidden /> Automations
          </DialogTitle>
          <DialogDescription>
            Rules run in the app while it&apos;s open, against issues you can edit. Changes apply on this device.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-4">
          {AUTOMATION_DEFS.map((def) => (
            <li key={def.key} className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor={`auto-${def.key}`} className="font-medium">
                  {def.label}
                </Label>
                <p className="text-sm text-muted-foreground">{def.description}</p>
              </div>
              <Switch
                id={`auto-${def.key}`}
                checked={settings[def.key]}
                onCheckedChange={(v) => toggle(def.key, v)}
              />
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
