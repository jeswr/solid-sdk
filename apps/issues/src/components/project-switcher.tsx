"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { listProjects, createProject } from "@/lib/workspaces";
import { Repository } from "@/lib/repository";
import type { TrackerLocation } from "@/lib/profile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Check, ChevronsUpDown, FolderKanban, Loader2, Plus } from "lucide-react";
import { shortWebId } from "@/lib/people";

interface Project {
  url: string;
  title: string;
}

/** Readable fallback when a project's config can't be read: its path slug. */
function titleFromUrl(url: string): string {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const slug = parts.length >= 2 ? parts[parts.length - 2] : "issues";
  return slug === "issue-tracker" ? "Issues" : slug.replace(/-/g, " ");
}

/**
 * Workspace switcher (Jira "projects" / Monday "boards"): lists the user's own
 * projects from the type index, switches between them, and creates new ones.
 */
export function ProjectSwitcher({
  webId,
  storageUrl,
  active,
  onSwitch,
}: {
  webId: string;
  storageUrl: string;
  active: TrackerLocation;
  onSwitch: (tracker: TrackerLocation) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const urls = await listProjects(webId, storageUrl);
      const titled = await Promise.all(
        urls.map(async (url) => {
          try {
            const info = await new Repository(url).info();
            return { url, title: info.title ?? titleFromUrl(url) };
          } catch {
            return { url, title: titleFromUrl(url) };
          }
        }),
      );
      setProjects(titled);
    } catch {
      /* discovery is sugar — switching still works via the default project */
    }
  }, [webId, storageUrl]);

  useEffect(() => {
    // Mount fetch; setState only runs after the awaits inside load().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const isOwn = active.ownerWebId === webId;
  const activeProject = projects.find((p) => p.url === active.trackerUrl);
  const label = isOwn
    ? (activeProject?.title ?? titleFromUrl(active.trackerUrl))
    : `${shortWebId(active.ownerWebId)}'s tracker`;

  const submit = async () => {
    setCreating(true);
    try {
      const url = await createProject(webId, storageUrl, name);
      toast.success(`Project "${name.trim()}" created`);
      setNewOpen(false);
      setName("");
      await load();
      onSwitch({ ownerWebId: webId, trackerUrl: url });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the project.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="min-w-0 gap-1.5" aria-label="Switch project">
            <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="max-w-[12rem] truncate font-medium">{label}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          {projects.map((p) => (
            <DropdownMenuItem
              key={p.url}
              onClick={() => onSwitch({ ownerWebId: webId, trackerUrl: p.url })}
            >
              <span className="min-w-0 flex-1 truncate">{p.title}</span>
              {isOwn && p.url === active.trackerUrl && <Check className="size-4" aria-hidden />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNewOpen(true)}>
            <Plus className="size-4" aria-hidden /> New project…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              A project is a separate tracker in your pod, with its own issues, sprints, and sharing.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Website redesign"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating || !name.trim()}>
                {creating && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Create project
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
