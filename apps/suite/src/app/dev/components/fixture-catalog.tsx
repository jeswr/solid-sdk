// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import * as Ui from "@jeswr/suite-ui";
import { Bold, MoreHorizontal, Plus } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { atomNames, type FixtureName, primitiveNames } from "./fixture-names";

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="fixture-field">
      <Ui.Label htmlFor={id}>{label}</Ui.Label>
      {children(id)}
    </div>
  );
}
const formSchema = z.object({ title: z.string().min(1, "Enter a title") });
function FormFixture() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: "" },
  });
  const [saved, setSaved] = useState(false);
  return (
    <Ui.Form {...form}>
      <form onSubmit={form.handleSubmit(() => setSaved(true))} className="fixture-field" noValidate>
        <Ui.FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <Ui.FormItem>
              <Ui.FormLabel>Document title</Ui.FormLabel>
              <Ui.FormControl>
                <Ui.Input {...field} />
              </Ui.FormControl>
              <Ui.FormDescription>Choose a title for your document.</Ui.FormDescription>
              <Ui.FormMessage />
            </Ui.FormItem>
          )}
        />
        <Ui.Button type="submit">Save title</Ui.Button>
        {saved && <p role="status">Saved to your pod</p>}
      </form>
    </Ui.Form>
  );
}
function CalendarFixture() {
  const [date, setDate] = useState<Date | undefined>(new Date(2026, 9, 25));
  return (
    <Ui.Calendar
      mode="single"
      selected={date}
      onSelect={setDate}
      defaultMonth={new Date(2026, 9, 1)}
      today={new Date(2026, 9, 25)}
      disabled={{ before: new Date(2026, 9, 5) }}
      labels={{
        labelDayButton: (day, modifiers) => {
          // Keep the visible number as a word in the name ("5", rather than "5th").
          let label = day.toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          });
          if (modifiers.today) label = `Today, ${label}`;
          if (modifiers.selected) label = `${label}, selected`;
          return label;
        },
      }}
    />
  );
}
function Primitives({ name }: { name: string }) {
  switch (name) {
    case "button":
      return (
        <div className="fixture-row">
          {(["default", "secondary", "outline", "ghost", "destructive", "link"] as const).map(
            (variant) => (
              <Ui.Button key={variant} variant={variant}>
                {variant}
              </Ui.Button>
            ),
          )}
          <Ui.Button size="sm">Small</Ui.Button>
          <Ui.Button disabled>Disabled</Ui.Button>
        </div>
      );
    case "icon-button":
      return (
        <div className="fixture-row">
          <Ui.IconButton label="Add item">
            <Plus aria-hidden="true" />
          </Ui.IconButton>
          <Ui.IconButton label="More actions" variant="ghost" size="icon-sm">
            <MoreHorizontal aria-hidden="true" />
          </Ui.IconButton>
          <Ui.IconButton label="Add item unavailable" disabled>
            <Plus aria-hidden="true" />
          </Ui.IconButton>
        </div>
      );
    case "input":
      return (
        <>
          <Field label="File name">
            {(id) => <Ui.Input id={id} placeholder="Untitled document" />}
          </Field>
          <Field label="Read only file name">
            {(id) => <Ui.Input id={id} defaultValue="Launch plan" readOnly />}
          </Field>
          <Field label="Unavailable file name">{(id) => <Ui.Input id={id} disabled />}</Field>
        </>
      );
    case "textarea":
      return (
        <>
          <Field label="Description">
            {(id) => <Ui.Textarea id={id} placeholder="Add a description" />}
          </Field>
          <Field label="Unavailable description">{(id) => <Ui.Textarea id={id} disabled />}</Field>
        </>
      );
    case "select":
      return (
        <>
          {[false, true].map((disabled) => (
            <Field key={String(disabled)} label={disabled ? "Unavailable role" : "Role"}>
              {(id) => (
                <Ui.Select defaultValue="viewer" disabled={disabled}>
                  <Ui.SelectTrigger id={id}>
                    <Ui.SelectValue />
                  </Ui.SelectTrigger>
                  <Ui.SelectContent position="popper">
                    <Ui.SelectItem value="viewer">Viewer</Ui.SelectItem>
                    <Ui.SelectItem value="editor">Editor</Ui.SelectItem>
                    <Ui.SelectItem value="manager" disabled>
                      Manager
                    </Ui.SelectItem>
                  </Ui.SelectContent>
                </Ui.Select>
              )}
            </Field>
          ))}
        </>
      );
    case "checkbox":
      return (
        <div className="fixture-row">
          {([false, true, "indeterminate"] as const).map((checked) => (
            <Field key={String(checked)} label={`Select ${checked}`}>
              {(id) => <Ui.Checkbox id={id} defaultChecked={checked} />}
            </Field>
          ))}
          <Field label="Selection unavailable">{(id) => <Ui.Checkbox id={id} disabled />}</Field>
        </div>
      );
    case "radio-group":
      return (
        <Ui.RadioGroup defaultValue="comfortable" aria-label="List density">
          <Field label="Comfortable">
            {(id) => <Ui.RadioGroupItem id={id} value="comfortable" />}
          </Field>
          <Field label="Compact">{(id) => <Ui.RadioGroupItem id={id} value="compact" />}</Field>
          <Field label="Unavailable density">
            {(id) => <Ui.RadioGroupItem id={id} value="unavailable" disabled />}
          </Field>
        </Ui.RadioGroup>
      );
    case "switch":
      return (
        <div className="fixture-row">
          <Field label="Enable notifications">{(id) => <Ui.Switch id={id} />}</Field>
          <Field label="Save copies">{(id) => <Ui.Switch id={id} defaultChecked />}</Field>
          <Field label="Unavailable setting">{(id) => <Ui.Switch id={id} disabled />}</Field>
        </div>
      );
    case "tabs":
      return (
        <Ui.Tabs defaultValue="details">
          <Ui.TabsList aria-label="File information">
            <Ui.TabsTrigger value="details">Details</Ui.TabsTrigger>
            <Ui.TabsTrigger value="activity">Activity</Ui.TabsTrigger>
            <Ui.TabsTrigger value="history" disabled>
              History
            </Ui.TabsTrigger>
          </Ui.TabsList>
          <Ui.TabsContent value="details">File details</Ui.TabsContent>
          <Ui.TabsContent value="activity">Recent activity</Ui.TabsContent>
        </Ui.Tabs>
      );
    case "dialog":
      return (
        <Ui.Dialog>
          <Ui.DialogTrigger asChild>
            <Ui.Button variant="outline">Open dialog</Ui.Button>
          </Ui.DialogTrigger>
          <Ui.DialogContent>
            <Ui.DialogHeader>
              <Ui.DialogTitle>Rename file</Ui.DialogTitle>
              <Ui.DialogDescription>Choose a new name for this file.</Ui.DialogDescription>
            </Ui.DialogHeader>
            <Field label="New name">
              {(id) => <Ui.Input id={id} defaultValue="Launch plan" />}
            </Field>
            <Ui.DialogFooter>
              <Ui.DialogClose asChild>
                <Ui.Button>Save name</Ui.Button>
              </Ui.DialogClose>
            </Ui.DialogFooter>
          </Ui.DialogContent>
        </Ui.Dialog>
      );
    case "sheet":
      return (
        <Ui.Sheet>
          <Ui.SheetTrigger asChild>
            <Ui.Button variant="outline">Open sheet</Ui.Button>
          </Ui.SheetTrigger>
          <Ui.SheetContent>
            <Ui.SheetHeader>
              <Ui.SheetTitle>File details</Ui.SheetTitle>
              <Ui.SheetDescription>Information about your file.</Ui.SheetDescription>
            </Ui.SheetHeader>
            <p className="p-4">Launch plan · Document</p>
            <Ui.SheetFooter>
              <Ui.SheetClose asChild>
                <Ui.Button variant="outline">Done</Ui.Button>
              </Ui.SheetClose>
            </Ui.SheetFooter>
          </Ui.SheetContent>
        </Ui.Sheet>
      );
    case "popover":
      return (
        <Ui.Popover>
          <Ui.PopoverTrigger asChild>
            <Ui.Button variant="outline">Open popover</Ui.Button>
          </Ui.PopoverTrigger>
          <Ui.PopoverContent aria-label="View options">
            <Field label="View name">{(id) => <Ui.Input id={id} defaultValue="My files" />}</Field>
          </Ui.PopoverContent>
        </Ui.Popover>
      );
    case "tooltip":
      return (
        <Ui.TooltipProvider>
          <Ui.Tooltip>
            <Ui.TooltipTrigger asChild>
              <Ui.Button variant="outline">Hover or focus for help</Ui.Button>
            </Ui.TooltipTrigger>
            <Ui.TooltipContent>Show saved copies of your files</Ui.TooltipContent>
          </Ui.Tooltip>
        </Ui.TooltipProvider>
      );
    case "dropdown-menu":
      return (
        <Ui.DropdownMenu>
          <Ui.DropdownMenuTrigger asChild>
            <Ui.Button variant="outline">File actions</Ui.Button>
          </Ui.DropdownMenuTrigger>
          <Ui.DropdownMenuContent>
            <Ui.DropdownMenuLabel>File actions</Ui.DropdownMenuLabel>
            <Ui.DropdownMenuItem>Open file</Ui.DropdownMenuItem>
            <Ui.DropdownMenuCheckboxItem checked>Available offline</Ui.DropdownMenuCheckboxItem>
            <Ui.DropdownMenuSeparator />
            <Ui.DropdownMenuItem disabled>Move to trash</Ui.DropdownMenuItem>
          </Ui.DropdownMenuContent>
        </Ui.DropdownMenu>
      );
    case "context-menu":
      return (
        <Ui.ContextMenu>
          <Ui.ContextMenuTrigger asChild>
            <Ui.Button variant="outline">Right click or press Shift+F10</Ui.Button>
          </Ui.ContextMenuTrigger>
          <Ui.ContextMenuContent>
            <Ui.ContextMenuItem>Open file</Ui.ContextMenuItem>
            <Ui.ContextMenuItem>Rename</Ui.ContextMenuItem>
            <Ui.ContextMenuItem disabled>Move to trash</Ui.ContextMenuItem>
          </Ui.ContextMenuContent>
        </Ui.ContextMenu>
      );
    case "command":
      return (
        <Ui.Command label="Find an action">
          <Ui.CommandInput placeholder="Find an action" aria-label="Find an action" />
          <Ui.CommandList>
            <Ui.CommandEmpty>No actions found.</Ui.CommandEmpty>
            <Ui.CommandGroup heading="Actions">
              <Ui.CommandItem>Create a document</Ui.CommandItem>
              <Ui.CommandItem>Upload a file</Ui.CommandItem>
              <Ui.CommandItem disabled>Share offline</Ui.CommandItem>
            </Ui.CommandGroup>
          </Ui.CommandList>
        </Ui.Command>
      );
    case "avatar":
      return (
        <div className="fixture-row">
          <Ui.Avatar>
            <Ui.AvatarImage src="/fixtures/suite-mark.svg" alt="Suite" />
            <Ui.AvatarFallback>SU</Ui.AvatarFallback>
          </Ui.Avatar>
          <Ui.Avatar aria-label="Alice Wilder">
            <Ui.AvatarFallback>AW</Ui.AvatarFallback>
          </Ui.Avatar>
        </div>
      );
    case "badge":
      return (
        <div className="fixture-row">
          {(["default", "secondary", "outline", "destructive"] as const).map((variant) => (
            <Ui.Badge key={variant} variant={variant}>
              {variant}
            </Ui.Badge>
          ))}
        </div>
      );
    case "separator":
      return (
        <div className="fixture-field">
          <p>Documents</p>
          <Ui.Separator />
          <p>Shared files</p>
        </div>
      );
    case "scroll-area":
      return (
        <Ui.ScrollArea
          className="h-40 rounded-lg border"
          role="region"
          aria-label="Recent documents"
        >
          <div className="p-3">
            {Array.from({ length: 15 }, (_, i) => `Document ${i + 1}`).map((document) => (
              <p key={document} className="py-2">
                {document}
              </p>
            ))}
          </div>
        </Ui.ScrollArea>
      );
    case "skeleton":
      return (
        <div role="status" aria-label="Loading files" className="fixture-field">
          {[1, 2, 3].map((row) => (
            <div key={row} className="fixture-row" aria-hidden="true">
              <Ui.Skeleton className="size-6" />
              <Ui.Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      );
    case "progress":
      return (
        <>
          <Ui.Progress value={40} aria-label="Uploading file" />
          <Ui.Progress value={null} aria-label="Preparing files" />
        </>
      );
    case "toast":
      return (
        <div className="fixture-row">
          <Ui.Button
            variant="outline"
            onClick={() => Ui.toast.success("Link copied", { duration: 5000 })}
          >
            Show success toast
          </Ui.Button>
          <Ui.Button
            variant="outline"
            onClick={() =>
              Ui.toast("Moved to trash", {
                duration: 8000,
                action: { label: "Undo", onClick: () => Ui.toast.success("File restored") },
              })
            }
          >
            Show undo toast
          </Ui.Button>
          <Ui.Button
            variant="outline"
            onClick={() =>
              Ui.toast.error("Can't reach your storage", {
                duration: Number.POSITIVE_INFINITY,
                cancel: { label: "Dismiss", onClick: () => {} },
              })
            }
          >
            Show error toast
          </Ui.Button>
        </div>
      );
    case "table":
      return (
        <Ui.Table>
          <Ui.TableCaption>Recent files</Ui.TableCaption>
          <Ui.TableHeader>
            <Ui.TableRow>
              <Ui.TableHead scope="col">Name</Ui.TableHead>
              <Ui.TableHead scope="col">Type</Ui.TableHead>
            </Ui.TableRow>
          </Ui.TableHeader>
          <Ui.TableBody>
            <Ui.TableRow>
              <Ui.TableCell>Launch plan</Ui.TableCell>
              <Ui.TableCell>Document</Ui.TableCell>
            </Ui.TableRow>
            <Ui.TableRow data-state="selected">
              <Ui.TableCell>Budget</Ui.TableCell>
              <Ui.TableCell>Spreadsheet</Ui.TableCell>
            </Ui.TableRow>
          </Ui.TableBody>
        </Ui.Table>
      );
    case "calendar":
      return <CalendarFixture />;
    case "form":
      return <FormFixture />;
    case "breadcrumb":
      return (
        <Ui.Breadcrumb>
          <Ui.BreadcrumbList>
            <Ui.BreadcrumbItem>
              <Ui.BreadcrumbLink href="/dev/components">Components</Ui.BreadcrumbLink>
            </Ui.BreadcrumbItem>
            <Ui.BreadcrumbSeparator />
            <Ui.BreadcrumbItem>
              <Ui.BreadcrumbPage>Primitives</Ui.BreadcrumbPage>
            </Ui.BreadcrumbItem>
          </Ui.BreadcrumbList>
        </Ui.Breadcrumb>
      );
    case "collapsible":
      return (
        <Ui.Collapsible>
          <Ui.CollapsibleTrigger asChild>
            <Ui.Button variant="outline">Toggle details</Ui.Button>
          </Ui.CollapsibleTrigger>
          <Ui.CollapsibleContent>Last modified today.</Ui.CollapsibleContent>
        </Ui.Collapsible>
      );
    case "accordion":
      return (
        <Ui.Accordion type="single" collapsible defaultValue="storage">
          <Ui.AccordionItem value="storage">
            <Ui.AccordionTrigger>Where are my files?</Ui.AccordionTrigger>
            <Ui.AccordionContent>Your files stay in your pod.</Ui.AccordionContent>
          </Ui.AccordionItem>
          <Ui.AccordionItem value="offline">
            <Ui.AccordionTrigger>Can I work offline?</Ui.AccordionTrigger>
            <Ui.AccordionContent>You can open saved copies.</Ui.AccordionContent>
          </Ui.AccordionItem>
          <Ui.AccordionItem value="disabled" disabled>
            <Ui.AccordionTrigger>Unavailable details</Ui.AccordionTrigger>
            <Ui.AccordionContent>Unavailable</Ui.AccordionContent>
          </Ui.AccordionItem>
        </Ui.Accordion>
      );
    case "toggle":
      return (
        <div className="fixture-row">
          <Ui.Tooltip>
            <Ui.TooltipTrigger asChild>
              <Ui.Toggle aria-label="Bold">
                <Bold aria-hidden="true" />
              </Ui.Toggle>
            </Ui.TooltipTrigger>
            <Ui.TooltipContent>Bold</Ui.TooltipContent>
          </Ui.Tooltip>
          <Ui.Toggle defaultPressed>Selected</Ui.Toggle>
          <Ui.Toggle disabled>Unavailable</Ui.Toggle>
        </div>
      );
    case "toggle-group":
      return (
        <Ui.ToggleGroup type="single" defaultValue="list" aria-label="Layout">
          <Ui.ToggleGroupItem value="list">List</Ui.ToggleGroupItem>
          <Ui.ToggleGroupItem value="grid">Grid</Ui.ToggleGroupItem>
          <Ui.ToggleGroupItem value="map" disabled>
            Map
          </Ui.ToggleGroupItem>
        </Ui.ToggleGroup>
      );
    case "slider":
      return (
        <>
          <Ui.Slider defaultValue={[40]} aria-label="Volume" />
          <Ui.Slider defaultValue={[20, 80]} aria-label="Range" />
          <Ui.Slider defaultValue={[25]} aria-label="Unavailable volume" disabled />
        </>
      );
    case "alert":
      return (
        <Ui.Alert>
          <Ui.AlertTitle>Showing saved copies</Ui.AlertTitle>
          <Ui.AlertDescription>Changes will sync when you reconnect.</Ui.AlertDescription>
        </Ui.Alert>
      );
    case "alert-dialog":
      return (
        <Ui.AlertDialog>
          <Ui.AlertDialogTrigger asChild>
            <Ui.Button variant="outline">Open confirmation</Ui.Button>
          </Ui.AlertDialogTrigger>
          <Ui.AlertDialogContent>
            <Ui.AlertDialogHeader>
              <Ui.AlertDialogTitle>Move file to trash?</Ui.AlertDialogTitle>
              <Ui.AlertDialogDescription>
                You can restore this file later.
              </Ui.AlertDialogDescription>
            </Ui.AlertDialogHeader>
            <Ui.AlertDialogFooter>
              <Ui.AlertDialogCancel>Cancel</Ui.AlertDialogCancel>
              <Ui.AlertDialogAction variant="destructive">Move to trash</Ui.AlertDialogAction>
            </Ui.AlertDialogFooter>
          </Ui.AlertDialogContent>
        </Ui.AlertDialog>
      );
    case "hover-card":
      return (
        <Ui.HoverCard>
          <Ui.HoverCardTrigger asChild>
            <a href="/dev/components/atoms">About the suite icons</a>
          </Ui.HoverCardTrigger>
          <Ui.HoverCardContent>Monochrome glyphs identify each app.</Ui.HoverCardContent>
        </Ui.HoverCard>
      );
    case "resizable":
      return (
        <Ui.ResizablePanelGroup orientation="horizontal" className="h-40 rounded-lg border">
          <Ui.ResizablePanel defaultSize="50%" minSize="20%">
            <p className="p-3">Files</p>
          </Ui.ResizablePanel>
          <Ui.ResizableHandle withHandle aria-label="Resize file panes" />
          <Ui.ResizablePanel defaultSize="50%" minSize="20%">
            <p className="p-3">Details</p>
          </Ui.ResizablePanel>
        </Ui.ResizablePanelGroup>
      );
    default:
      return null;
  }
}
const files = [
  ["folder", "Finance"],
  ["image/png", "Photo.png"],
  ["application/pdf", "Trip.pdf"],
  ["application/msword", "Report.doc"],
  ["pd:Document", "Launch plan"],
  ["application/vnd.ms-excel", "Budget.xls"],
  ["text/csv", "Budget.csv"],
  ["audio/mpeg", "Track.mp3"],
  ["video/mp4", "Rehearsal.mp4"],
  ["application/zip", "Archive.zip"],
  ["text/plain", "Readme.txt"],
  ["text/markdown", "Readme.md"],
  ["application/rdf+xml", "Contacts.rdf"],
  ["text/turtle", "Contacts.ttl"],
  ["application/ld+json", "Contacts.jsonld"],
  ["application/octet-stream", "Unknown.bin"],
] as const;
function Atoms({ name }: { name: string }) {
  switch (name) {
    case "app-icon":
      return (
        <ul className="fixture-app-grid">
          {(Object.keys(Ui.APP_ICONS) as Ui.AppId[]).map((app) => (
            <li key={app}>
              <div className="fixture-row">
                {([32, 40, 48] as const).map((size) => (
                  <Ui.AppIcon key={size} app={app} size={size} />
                ))}
              </div>
              <span>{Ui.APP_ICONS[app].label}</span>
            </li>
          ))}
        </ul>
      );
    case "file-type-icon":
      return (
        <ul className="fixture-file-grid">
          {files.map(([contentType, name]) => (
            <li key={`${contentType}-${name}`}>
              <Ui.FileTypeIcon contentType={contentType} name={name} size={24} />
              <span>{name}</span>
            </li>
          ))}
          <li>
            <Ui.FileTypeIcon
              contentType="image/svg+xml"
              name="Thumbnail.svg"
              thumbnailSrc="/fixtures/suite-mark.svg"
              size={40}
            />
            <span>Image thumbnail</span>
          </li>
        </ul>
      );
    case "provenance-badge":
      return (
        <div className="fixture-row">
          <Ui.ProvenanceBadge source="Solid Suite" logoSrc="/fixtures/suite-mark.svg" />
          <Ui.ProvenanceBadge source="Spotify" />
          <Ui.ProvenanceBadge source="Netflix" />
          <Ui.ProvenanceBadge source="Missing logo" logoSrc="/fixtures/missing.svg" />
        </div>
      );
    case "kbd":
      return (
        <div className="fixture-row">
          <Ui.Kbd aria-label="Command or Control K">⌘/Ctrl K</Ui.Kbd>
          <Ui.Kbd>Esc</Ui.Kbd>
          <Ui.Kbd>/</Ui.Kbd>
          <Ui.Kbd>g</Ui.Kbd>
          <span>then</span>
          <Ui.Kbd>h</Ui.Kbd>
        </div>
      );
    case "status-dot":
      return (
        <div className="fixture-row">
          {(Object.keys(Ui.STATUS_DOT_LABELS) as Ui.StatusDotProps["status"][]).map((status) => (
            <Ui.StatusDot key={status} status={status} />
          ))}
        </div>
      );
    case "count-badge":
      return (
        <div className="fixture-row">
          {[0, 7, 99, 100].map((count) => (
            <Ui.CountBadge key={count} count={count} />
          ))}
        </div>
      );
    default:
      return null;
  }
}
function StateExamples() {
  return (
    <section aria-label="Async state examples">
      <h2>State reference</h2>
      <div className="sample-grid">
        <div className="foundation-card">
          <h3>Loading files</h3>
          <Primitives name="skeleton" />
        </div>
        <div className="foundation-card fixture-empty">
          <h3>Your Drive is empty</h3>
          <p>Upload files or create a folder to get started.</p>
          <Ui.Button onClick={() => Ui.toast("Choose a file in Drive")}>Upload a file</Ui.Button>
        </div>
        <div className="foundation-card fixture-empty">
          <h3>No results for 'budget'</h3>
          <Ui.Button variant="outline" onClick={() => Ui.toast("Filters cleared")}>
            Clear filters
          </Ui.Button>
        </div>
        <Ui.Alert variant="destructive">
          <Ui.AlertTitle>Can't reach your storage</Ui.AlertTitle>
          <Ui.AlertDescription>
            We'll keep trying. You can still open items you've saved.
          </Ui.AlertDescription>
          <div className="fixture-row">
            <Ui.Button variant="outline" onClick={() => Ui.toast("Trying again…")}>
              Retry
            </Ui.Button>
            <Ui.Button variant="ghost" onClick={() => Ui.toast("Showing saved copies")}>
              Show saved copies
            </Ui.Button>
          </div>
        </Ui.Alert>
      </div>
    </section>
  );
}
export function FixtureCatalog({ name }: { name: FixtureName }) {
  const names = name === "primitives" ? primitiveNames : name === "atoms" ? atomNames : [name];
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page">
      <div className="fixture-heading">
        <p className="eyebrow">Solid Suite · Design system</p>
        <h1>{name}</h1>
        <a href="/dev/components">All component fixtures</a>
      </div>
      <Ui.TooltipProvider>
        <div className="sample-grid">
          {(["comfortable", "compact"] as const).map((density) => (
            <section
              key={density}
              data-density={density}
              aria-label={`${density} fixtures`}
              className="fixture-density"
            >
              <h2>{density === "compact" ? "Compact" : "Comfortable"}</h2>
              {names.map((component) => (
                <section
                  key={component}
                  className="foundation-card fixture-component"
                  data-fixture={component}
                >
                  <h3>{component}</h3>
                  <div className="fixture-field">
                    {atomNames.includes(component as (typeof atomNames)[number]) ? (
                      <Atoms name={component} />
                    ) : (
                      <Primitives name={component} />
                    )}
                  </div>
                </section>
              ))}
            </section>
          ))}
        </div>
      </Ui.TooltipProvider>
      {name === "primitives" && <StateExamples />}
      <Ui.Toaster />
    </main>
  );
}
