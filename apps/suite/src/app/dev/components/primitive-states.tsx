// AUTHORED-BY Claude Opus 5.5
"use client";
// Extra documented states for the primitive fixtures (DS-13): sizes, variants, invalid,
// read-only and the sub-parts (groups, shortcuts, sub-menus, media) the base examples skip.
// Each block renders once per density region, so names stay unique within a region and
// never collide with the ds-02 selectors for the base examples.
import * as Ui from "@jeswr/suite-ui";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Check,
  Italic,
  Plus,
  Trash2,
  Underline,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";

function Labelled({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="fixture-field">
      <Ui.Label htmlFor={id}>{label}</Ui.Label>
      {children(id)}
    </div>
  );
}
function Invalid({
  label,
  message,
  children,
}: {
  label: string;
  message: string;
  children: (id: string, describedBy: string) => ReactNode;
}) {
  const id = useId();
  const error = `${id}-error`;
  return (
    <div className="fixture-field">
      <Ui.Label htmlFor={id}>{label}</Ui.Label>
      {children(id, error)}
      <p id={error} className="text-sm text-destructive">
        {message}
      </p>
    </div>
  );
}
function States({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="fixture-field" data-fixture-state={title}>
      <h4 className="text-sm font-medium text-foreground-muted">{title}</h4>
      {children}
    </div>
  );
}
function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Ui.Tooltip>
      <Ui.TooltipTrigger asChild>{children}</Ui.TooltipTrigger>
      <Ui.TooltipContent>{label}</Ui.TooltipContent>
    </Ui.Tooltip>
  );
}
function DialogCommand() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Ui.Button variant="outline" onClick={() => setOpen(true)}>
        Open command dialog
      </Ui.Button>
      <Ui.CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Find an action"
        description="Search for an action to run"
      >
        <Ui.CommandInput placeholder="Find an action" aria-label="Find an action" />
        <Ui.CommandList>
          <Ui.CommandEmpty>No actions found.</Ui.CommandEmpty>
          <Ui.CommandGroup heading="Create">
            <Ui.CommandItem>
              New document
              <Ui.CommandShortcut>C</Ui.CommandShortcut>
            </Ui.CommandItem>
          </Ui.CommandGroup>
          <Ui.CommandSeparator />
          <Ui.CommandGroup heading="Go to">
            <Ui.CommandItem>
              Drive
              <Ui.CommandShortcut>G D</Ui.CommandShortcut>
            </Ui.CommandItem>
          </Ui.CommandGroup>
        </Ui.CommandList>
      </Ui.CommandDialog>
    </>
  );
}

export function PrimitiveStates({ name }: { name: string }) {
  switch (name) {
    case "button":
      return (
        <States title="Sizes and icon buttons">
          <div className="fixture-row">
            <Ui.Button size="xs">Extra small</Ui.Button>
            <Ui.Button size="lg">Large</Ui.Button>
            <Ui.Button variant="outline" disabled>
              Unavailable outline
            </Ui.Button>
            {(["icon-xs", "icon-sm", "icon", "icon-lg"] as const).map((size) => (
              <Ui.Tooltip key={size}>
                <Ui.TooltipTrigger asChild>
                  <Ui.Button size={size} variant="outline" aria-label={`Add, ${size}`}>
                    <Plus aria-hidden="true" />
                  </Ui.Button>
                </Ui.TooltipTrigger>
                <Ui.TooltipContent>Add, {size}</Ui.TooltipContent>
              </Ui.Tooltip>
            ))}
            <Ui.Button variant="secondary">
              <Check aria-hidden="true" />
              With icon
            </Ui.Button>
          </div>
        </States>
      );
    case "input":
      return (
        <States title="Invalid and search">
          <Invalid label="Folder name" message="A folder with this name already exists">
            {(id, describedBy) => (
              <Ui.Input
                id={id}
                defaultValue="Projects"
                aria-invalid="true"
                aria-describedby={describedBy}
              />
            )}
          </Invalid>
          <Labelled label="Search files">
            {(id) => <Ui.Input id={id} type="search" defaultValue="budget" />}
          </Labelled>
        </States>
      );
    case "textarea":
      return (
        <States title="Invalid and read only">
          <Invalid label="Summary" message="Enter a summary">
            {(id, describedBy) => (
              <Ui.Textarea id={id} aria-invalid="true" aria-describedby={describedBy} />
            )}
          </Invalid>
          <Labelled label="Read only summary">
            {(id) => <Ui.Textarea id={id} defaultValue="Shared with the project team." readOnly />}
          </Labelled>
        </States>
      );
    case "select":
      return (
        <States title="Groups, small and invalid">
          <Labelled label="Save to">
            {(id) => (
              <Ui.Select defaultValue="drive">
                <Ui.SelectTrigger id={id} size="sm">
                  <Ui.SelectValue />
                </Ui.SelectTrigger>
                <Ui.SelectContent position="popper">
                  <Ui.SelectGroup>
                    <Ui.SelectLabel>Your storage</Ui.SelectLabel>
                    <Ui.SelectItem value="drive">My Drive</Ui.SelectItem>
                    <Ui.SelectItem value="docs">Documents</Ui.SelectItem>
                  </Ui.SelectGroup>
                  <Ui.SelectSeparator />
                  <Ui.SelectGroup>
                    <Ui.SelectLabel>Shared</Ui.SelectLabel>
                    <Ui.SelectItem value="team">Team folder</Ui.SelectItem>
                  </Ui.SelectGroup>
                </Ui.SelectContent>
              </Ui.Select>
            )}
          </Labelled>
          <Invalid label="Access level" message="Choose an access level">
            {(id, describedBy) => (
              <Ui.Select>
                <Ui.SelectTrigger id={id} aria-invalid="true" aria-describedby={describedBy}>
                  <Ui.SelectValue placeholder="Choose access" />
                </Ui.SelectTrigger>
                <Ui.SelectContent position="popper">
                  <Ui.SelectItem value="viewer">Viewer</Ui.SelectItem>
                  <Ui.SelectItem value="editor">Editor</Ui.SelectItem>
                </Ui.SelectContent>
              </Ui.Select>
            )}
          </Invalid>
        </States>
      );
    case "checkbox":
      return (
        <States title="Invalid and checked unavailable">
          <div className="fixture-row">
            <Invalid label="Accept the sharing terms" message="Accept the terms to continue">
              {(id, describedBy) => (
                <Ui.Checkbox id={id} aria-invalid="true" aria-describedby={describedBy} />
              )}
            </Invalid>
            <Labelled label="Always included">
              {(id) => <Ui.Checkbox id={id} defaultChecked disabled />}
            </Labelled>
          </div>
        </States>
      );
    case "radio-group":
      return (
        <States title="Unavailable group">
          <Ui.RadioGroup defaultValue="weekly" aria-label="Backup schedule" disabled>
            <Labelled label="Daily">{(id) => <Ui.RadioGroupItem id={id} value="daily" />}</Labelled>
            <Labelled label="Weekly">
              {(id) => <Ui.RadioGroupItem id={id} value="weekly" />}
            </Labelled>
          </Ui.RadioGroup>
        </States>
      );
    case "switch":
      return (
        <States title="Small and checked unavailable">
          <div className="fixture-row">
            <Labelled label="Compact switch">{(id) => <Ui.Switch id={id} size="sm" />}</Labelled>
            <Labelled label="Locked setting">
              {(id) => <Ui.Switch id={id} defaultChecked disabled />}
            </Labelled>
          </div>
        </States>
      );
    case "tabs":
      return (
        <States title="Line and vertical">
          <Ui.Tabs defaultValue="people">
            <Ui.TabsList variant="line" aria-label="Sharing views">
              <Ui.TabsTrigger value="people">People</Ui.TabsTrigger>
              <Ui.TabsTrigger value="links">Links</Ui.TabsTrigger>
            </Ui.TabsList>
            <Ui.TabsContent value="people">Two people have access</Ui.TabsContent>
            <Ui.TabsContent value="links">No links yet</Ui.TabsContent>
          </Ui.Tabs>
          <Ui.Tabs defaultValue="general" orientation="vertical">
            <Ui.TabsList aria-label="Settings sections">
              <Ui.TabsTrigger value="general">General</Ui.TabsTrigger>
              <Ui.TabsTrigger value="storage">Storage</Ui.TabsTrigger>
            </Ui.TabsList>
            <Ui.TabsContent value="general">General settings</Ui.TabsContent>
            <Ui.TabsContent value="storage">Storage settings</Ui.TabsContent>
          </Ui.Tabs>
        </States>
      );
    case "sheet":
      return (
        <States title="Sides">
          <div className="fixture-row">
            {(["left", "top", "bottom"] as const).map((side) => (
              <Ui.Sheet key={side}>
                <Ui.SheetTrigger asChild>
                  <Ui.Button variant="outline">Open {side} sheet</Ui.Button>
                </Ui.SheetTrigger>
                <Ui.SheetContent side={side}>
                  <Ui.SheetHeader>
                    <Ui.SheetTitle>Folder details</Ui.SheetTitle>
                    <Ui.SheetDescription>Opened from the {side}.</Ui.SheetDescription>
                  </Ui.SheetHeader>
                </Ui.SheetContent>
              </Ui.Sheet>
            ))}
          </div>
        </States>
      );
    case "popover":
      return (
        <States title="Header, title and description">
          <Ui.Popover>
            <Ui.PopoverTrigger asChild>
              <Ui.Button variant="outline">Open storage popover</Ui.Button>
            </Ui.PopoverTrigger>
            <Ui.PopoverContent aria-label="Storage">
              <Ui.PopoverHeader>
                <Ui.PopoverTitle>Storage</Ui.PopoverTitle>
                <Ui.PopoverDescription>3.1 GB of 10 GB used.</Ui.PopoverDescription>
              </Ui.PopoverHeader>
            </Ui.PopoverContent>
          </Ui.Popover>
        </States>
      );
    case "dropdown-menu":
      return (
        <States title="Groups, choices, shortcuts and sub-menu">
          <Ui.DropdownMenu>
            <Ui.DropdownMenuTrigger asChild>
              <Ui.Button variant="outline">Sort and view</Ui.Button>
            </Ui.DropdownMenuTrigger>
            <Ui.DropdownMenuContent>
              <Ui.DropdownMenuGroup>
                <Ui.DropdownMenuLabel>Sort by</Ui.DropdownMenuLabel>
                <Ui.DropdownMenuRadioGroup value="name">
                  <Ui.DropdownMenuRadioItem value="name">Name</Ui.DropdownMenuRadioItem>
                  <Ui.DropdownMenuRadioItem value="modified">Modified</Ui.DropdownMenuRadioItem>
                </Ui.DropdownMenuRadioGroup>
              </Ui.DropdownMenuGroup>
              <Ui.DropdownMenuSeparator />
              <Ui.DropdownMenuItem>
                Select all
                <Ui.DropdownMenuShortcut>Ctrl A</Ui.DropdownMenuShortcut>
              </Ui.DropdownMenuItem>
              <Ui.DropdownMenuSub>
                <Ui.DropdownMenuSubTrigger>Move to</Ui.DropdownMenuSubTrigger>
                <Ui.DropdownMenuSubContent>
                  <Ui.DropdownMenuItem>Work</Ui.DropdownMenuItem>
                  <Ui.DropdownMenuItem>Personal</Ui.DropdownMenuItem>
                </Ui.DropdownMenuSubContent>
              </Ui.DropdownMenuSub>
              <Ui.DropdownMenuSeparator />
              <Ui.DropdownMenuItem variant="destructive">
                <Trash2 aria-hidden="true" />
                Delete forever
              </Ui.DropdownMenuItem>
            </Ui.DropdownMenuContent>
          </Ui.DropdownMenu>
        </States>
      );
    case "command":
      return (
        <States title="Dialog with groups and shortcuts">
          <DialogCommand />
        </States>
      );
    case "avatar":
      return (
        <States title="Sizes, badge and group">
          <div className="fixture-row">
            {(["sm", "default", "lg"] as const).map((size) => (
              <Ui.Avatar key={size} size={size} role="img" aria-label={`Sam Rivera, ${size}`}>
                <Ui.AvatarFallback>SR</Ui.AvatarFallback>
              </Ui.Avatar>
            ))}
            <Ui.Avatar role="img" aria-label="Jo Park, online">
              <Ui.AvatarFallback>JP</Ui.AvatarFallback>
              <Ui.AvatarBadge />
            </Ui.Avatar>
            <Ui.AvatarGroup role="group" aria-label="People with access">
              {["AW", "SR", "JP"].map((initials) => (
                <Ui.Avatar key={initials} aria-hidden="true">
                  <Ui.AvatarFallback>{initials}</Ui.AvatarFallback>
                </Ui.Avatar>
              ))}
              <Ui.AvatarGroupCount aria-hidden="true">+4</Ui.AvatarGroupCount>
              <span className="sr-only">Alice Wilder, Sam Rivera, Jo Park and 4 others</span>
            </Ui.AvatarGroup>
          </div>
        </States>
      );
    case "badge":
      return (
        <States title="Ghost and link">
          <div className="fixture-row">
            <Ui.Badge variant="ghost">ghost</Ui.Badge>
            <Ui.Badge variant="link" asChild>
              <a href="/dev/components/badge">Badge fixtures</a>
            </Ui.Badge>
          </div>
        </States>
      );
    case "separator":
      return (
        <States title="Vertical">
          <div className="fixture-row h-6">
            <span>Files</span>
            <Ui.Separator orientation="vertical" />
            <span>Photos</span>
          </div>
        </States>
      );
    case "scroll-area":
      return (
        <States title="Horizontal">
          <Ui.ScrollArea
            className="w-full max-w-72 rounded-lg border whitespace-nowrap"
            role="region"
            aria-label="Albums"
          >
            <div className="flex gap-3 p-3">
              {Array.from({ length: 10 }, (_, i) => `Album ${i + 1}`).map((album) => (
                <span key={album} className="rounded-md border px-3 py-6">
                  {album}
                </span>
              ))}
            </div>
            <Ui.ScrollBar orientation="horizontal" />
          </Ui.ScrollArea>
        </States>
      );
    case "progress":
      return (
        <States title="Not started and complete">
          <Ui.Progress value={0} aria-label="Waiting to upload" />
          <Ui.Progress value={100} aria-label="Upload complete" />
        </States>
      );
    case "table":
      return (
        <States title="With footer">
          <Ui.Table>
            <Ui.TableCaption>Storage by type</Ui.TableCaption>
            <Ui.TableHeader>
              <Ui.TableRow>
                <Ui.TableHead scope="col">Type</Ui.TableHead>
                <Ui.TableHead scope="col">Size</Ui.TableHead>
              </Ui.TableRow>
            </Ui.TableHeader>
            <Ui.TableBody>
              <Ui.TableRow>
                <Ui.TableCell>Photos</Ui.TableCell>
                <Ui.TableCell>2.4 GB</Ui.TableCell>
              </Ui.TableRow>
              <Ui.TableRow>
                <Ui.TableCell>Documents</Ui.TableCell>
                <Ui.TableCell>0.7 GB</Ui.TableCell>
              </Ui.TableRow>
            </Ui.TableBody>
            <Ui.TableFooter>
              <Ui.TableRow>
                <Ui.TableCell>Total</Ui.TableCell>
                <Ui.TableCell>3.1 GB</Ui.TableCell>
              </Ui.TableRow>
            </Ui.TableFooter>
          </Ui.Table>
        </States>
      );
    case "breadcrumb":
      return (
        <States title="Collapsed middle">
          <Ui.Breadcrumb aria-label="Collapsed path">
            <Ui.BreadcrumbList>
              <Ui.BreadcrumbItem>
                <Ui.BreadcrumbLink href="/dev/components">Components</Ui.BreadcrumbLink>
              </Ui.BreadcrumbItem>
              <Ui.BreadcrumbSeparator />
              <Ui.BreadcrumbItem>
                <Ui.BreadcrumbEllipsis />
              </Ui.BreadcrumbItem>
              <Ui.BreadcrumbSeparator />
              <Ui.BreadcrumbItem>
                <Ui.BreadcrumbPage>Breadcrumb</Ui.BreadcrumbPage>
              </Ui.BreadcrumbItem>
            </Ui.BreadcrumbList>
          </Ui.Breadcrumb>
        </States>
      );
    case "collapsible":
      return (
        <States title="Open by default">
          <Ui.Collapsible defaultOpen>
            <Ui.CollapsibleTrigger asChild>
              <Ui.Button variant="outline">Show sharing history</Ui.Button>
            </Ui.CollapsibleTrigger>
            <Ui.CollapsibleContent>Shared with Sam Rivera yesterday.</Ui.CollapsibleContent>
          </Ui.Collapsible>
        </States>
      );
    case "toggle":
      return (
        <States title="Outline and sizes">
          <div className="fixture-row">
            <Tip label="Italic">
              <Ui.Toggle variant="outline" aria-label="Italic">
                <Italic aria-hidden="true" />
              </Ui.Toggle>
            </Tip>
            <Ui.Toggle variant="outline" size="sm" defaultPressed>
              Small
            </Ui.Toggle>
            <Ui.Toggle size="lg">Large</Ui.Toggle>
          </div>
        </States>
      );
    case "toggle-group":
      return (
        <States title="Multiple, outline and small">
          <Ui.ToggleGroup type="multiple" variant="outline" aria-label="Text style">
            <Tip label="Italic">
              <Ui.ToggleGroupItem value="italic" aria-label="Italic">
                <Italic aria-hidden="true" />
              </Ui.ToggleGroupItem>
            </Tip>
            <Tip label="Underline">
              <Ui.ToggleGroupItem value="underline" aria-label="Underline">
                <Underline aria-hidden="true" />
              </Ui.ToggleGroupItem>
            </Tip>
          </Ui.ToggleGroup>
          <Ui.ToggleGroup type="single" size="sm" defaultValue="left" aria-label="Alignment">
            <Tip label="Align left">
              <Ui.ToggleGroupItem value="left" aria-label="Align left">
                <AlignLeft aria-hidden="true" />
              </Ui.ToggleGroupItem>
            </Tip>
            <Tip label="Align centre">
              <Ui.ToggleGroupItem value="center" aria-label="Align centre">
                <AlignCenter aria-hidden="true" />
              </Ui.ToggleGroupItem>
            </Tip>
            <Tip label="Align right">
              <Ui.ToggleGroupItem value="right" aria-label="Align right">
                <AlignRight aria-hidden="true" />
              </Ui.ToggleGroupItem>
            </Tip>
          </Ui.ToggleGroup>
        </States>
      );
    case "alert":
      return (
        <States title="Destructive">
          <Ui.Alert variant="destructive">
            <Ui.AlertTitle>Can't reach your storage</Ui.AlertTitle>
            <Ui.AlertDescription>We'll keep trying.</Ui.AlertDescription>
          </Ui.Alert>
        </States>
      );
    case "alert-dialog":
      return (
        <States title="Small with media">
          <Ui.AlertDialog>
            <Ui.AlertDialogTrigger asChild>
              <Ui.Button variant="outline">Open small confirmation</Ui.Button>
            </Ui.AlertDialogTrigger>
            <Ui.AlertDialogContent size="sm">
              <Ui.AlertDialogHeader>
                <Ui.AlertDialogMedia>
                  <Trash2 aria-hidden="true" />
                </Ui.AlertDialogMedia>
                <Ui.AlertDialogTitle>Empty trash?</Ui.AlertDialogTitle>
                <Ui.AlertDialogDescription>
                  Items in trash will be deleted forever.
                </Ui.AlertDialogDescription>
              </Ui.AlertDialogHeader>
              <Ui.AlertDialogFooter>
                <Ui.AlertDialogCancel>Keep items</Ui.AlertDialogCancel>
                <Ui.AlertDialogAction variant="destructive">Empty trash</Ui.AlertDialogAction>
              </Ui.AlertDialogFooter>
            </Ui.AlertDialogContent>
          </Ui.AlertDialog>
        </States>
      );
    case "resizable":
      return (
        <States title="Vertical">
          <Ui.ResizablePanelGroup
            orientation="vertical"
            className="rounded-lg border"
            // Vertical panels share the group's height, so it needs a definite one.
            style={{ height: "14rem" }}
          >
            <Ui.ResizablePanel defaultSize="60%" minSize="20%">
              <p className="p-3">Preview</p>
            </Ui.ResizablePanel>
            <Ui.ResizableHandle aria-label="Resize preview rows" />
            <Ui.ResizablePanel defaultSize="40%" minSize="20%">
              <p className="p-3">Comments</p>
            </Ui.ResizablePanel>
          </Ui.ResizablePanelGroup>
        </States>
      );
    case "context-menu-items":
      // Rendered inside the base context menu: the ds-02 trigger lookup needs one button.
      return (
        <>
          <Ui.ContextMenuSeparator />
          <Ui.ContextMenuGroup>
            <Ui.ContextMenuLabel>View</Ui.ContextMenuLabel>
            <Ui.ContextMenuCheckboxItem checked>Show details</Ui.ContextMenuCheckboxItem>
            <Ui.ContextMenuRadioGroup value="list">
              <Ui.ContextMenuRadioItem value="list">As rows</Ui.ContextMenuRadioItem>
              <Ui.ContextMenuRadioItem value="grid">As cards</Ui.ContextMenuRadioItem>
            </Ui.ContextMenuRadioGroup>
          </Ui.ContextMenuGroup>
          <Ui.ContextMenuSeparator />
          <Ui.ContextMenuItem>
            Copy link
            <Ui.ContextMenuShortcut>Ctrl C</Ui.ContextMenuShortcut>
          </Ui.ContextMenuItem>
          <Ui.ContextMenuSub>
            <Ui.ContextMenuSubTrigger>Move to</Ui.ContextMenuSubTrigger>
            <Ui.ContextMenuSubContent>
              <Ui.ContextMenuItem>Work</Ui.ContextMenuItem>
              <Ui.ContextMenuItem>Personal</Ui.ContextMenuItem>
            </Ui.ContextMenuSubContent>
          </Ui.ContextMenuSub>
        </>
      );
    case "command-items":
      // Rendered inside the base command list: the ds-02 search lookup needs one combobox.
      return (
        <>
          <Ui.CommandSeparator />
          <Ui.CommandGroup heading="Go to">
            <Ui.CommandItem>
              Open Drive
              <Ui.CommandShortcut>G D</Ui.CommandShortcut>
            </Ui.CommandItem>
            <Ui.CommandItem>
              Open settings
              <Ui.CommandShortcut>G S</Ui.CommandShortcut>
            </Ui.CommandItem>
          </Ui.CommandGroup>
        </>
      );
    default:
      return null;
  }
}
