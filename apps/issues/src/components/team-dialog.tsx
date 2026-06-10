"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Repository } from "@/lib/repository";
import { usePeople } from "@/lib/people";
import { PersonAvatar } from "@/components/person";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, UserPlus, Users, X } from "lucide-react";

/**
 * Manage the tracker's assignee group (`vcard:Group`). Members are added by WebID
 * (that's how Solid identifies people) but displayed as contact cards — profile
 * name + avatar — never raw IRIs.
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
  const [members, setMembers] = useState<string[]>([]);
  const [newWebId, setNewWebId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const people = usePeople(members);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    new Repository(trackerUrl)
      .info()
      .then((info) => {
        if (!cancelled) setMembers(info.groupMembers);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, trackerUrl]);

  const persist = async (next: string[]) => {
    setBusy(true);
    try {
      await new Repository(trackerUrl).setAssigneeGroup(next);
      setMembers(next);
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the team.");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const webId = newWebId.trim();
    if (!/^https?:\/\//.test(webId)) {
      toast.error("Enter the member's WebID (an http(s) URL).");
      return;
    }
    if (members.includes(webId)) {
      toast.info("Already a member.");
      return;
    }
    await persist([...members, webId]);
    setNewWebId("");
    toast.success("Member added");
  };

  const remove = async (webId: string) => {
    await persist(members.filter((m) => m !== webId));
    toast.success("Member removed");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4" aria-hidden /> Team members
          </DialogTitle>
          <DialogDescription>
            Add people by WebID. Issues can be assigned to the team, and the team can be granted access.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="new-member" className="sr-only">
              Member WebID
            </Label>
            <Input
              id="new-member"
              type="url"
              placeholder="https://…/profile/card#me"
              value={newWebId}
              onChange={(e) => setNewWebId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              disabled={busy}
            />
          </div>
          <Button onClick={add} disabled={busy || !newWebId.trim()} className="gap-1.5">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
            Add
          </Button>
        </div>

        <div className="min-h-24">
          {loading ? (
            <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading team…
            </p>
          ) : members.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No members yet — add a teammate&apos;s WebID above.</p>
          ) : (
            <ul className="space-y-2">
              {members.map((webId) => {
                const person = people.find((p) => p.webId === webId);
                return (
                  <li key={webId} className="flex items-center gap-3 rounded-lg border bg-card p-2">
                    <PersonAvatar webId={webId} className="size-8" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{person?.name ?? "…"}</span>
                      <span className="block truncate text-xs text-muted-foreground">{webId}</span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${person?.name ?? webId} from the team`}
                      onClick={() => remove(webId)}
                      disabled={busy}
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
