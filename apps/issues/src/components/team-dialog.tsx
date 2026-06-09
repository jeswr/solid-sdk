"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Repository } from "@/lib/repository";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

/**
 * Manage the tracker's assignee group (`vcard:Group` + `vcard:hasMember`). Members
 * are entered one WebID per line; issues can then be assigned to the group and the
 * group granted access.
 */
export function TeamDialog({
  open,
  onOpenChange,
  trackerUrl,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackerUrl: string;
  onSaved?: () => void;
}) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Fetch on open; the spinner toggle is intentional here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    new Repository(trackerUrl)
      .info()
      .then((info) => {
        if (!cancelled) setValue(info.groupMembers.join("\n"));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, trackerUrl]);

  const save = async () => {
    const members = value
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//.test(l));
    setBusy(true);
    try {
      await new Repository(trackerUrl).setAssigneeGroup(members);
      toast.success("Team updated");
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the team.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Team members</DialogTitle>
          <DialogDescription>
            One WebID per line. Issues can be assigned to the team, and the team can be granted access.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="members">Member WebIDs</Label>
          <Textarea
            id="members"
            rows={5}
            placeholder={"https://…/profile/card#me\nhttps://…/profile/card#me"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={loading || busy}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || loading}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Save team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
