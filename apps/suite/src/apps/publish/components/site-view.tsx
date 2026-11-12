// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  type PageData,
  pageUrl,
  type SiteData,
  type StoredPage,
  type StoredSite,
  THEMES,
  uniqueSlug,
  validateSite,
} from "@jeswr/solid-publish";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  IconButton,
  Input,
  Label,
  toast,
} from "@jeswr/suite-ui";
import { ArrowDown, ArrowUp, Copy, ExternalLink, FileText, Plus, Settings2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { AppHeading } from "@/shell/app-frame";
import { useConnectionState } from "@/shell/sync/connection-state";
import { RequiresOnline } from "@/shell/sync/requires-online";
import { usePublish } from "../state/publish-context";

export function PublicLink({ url }: { url: string }) {
  return (
    <div className="pub-public-link">
      <a href={url} target="_blank" rel="noopener noreferrer">
        {url}
        <ExternalLink size={14} aria-hidden="true" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <IconButton
        variant="ghost"
        label="Copy public URL"
        onClick={() => {
          void Promise.resolve()
            .then(() => navigator.clipboard.writeText(url))
            .then(
              () => toast.success("Public URL copied"),
              () => toast.error("Couldn't copy the URL. Select the link to copy it."),
            );
        }}
      >
        <Copy size={16} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
function SiteFields({
  initial,
  submit,
  label,
  cancel,
}: {
  initial: SiteData;
  submit: (value: SiteData) => void;
  label: string;
  cancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const online = useConnectionState() === "online";
  function save(event: FormEvent) {
    event.preventDefault();
    try {
      submit(validateSite({ ...value, modified: new Date() }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the site settings.");
    }
  }
  return (
    <form onSubmit={save} className="pub-form">
      <Label htmlFor="pub-site-name">Site name</Label>
      <Input
        id="pub-site-name"
        value={value.name}
        required
        maxLength={160}
        onChange={(e) => setValue({ ...value, name: e.target.value })}
      />
      <Label htmlFor="pub-site-tagline">Tagline</Label>
      <Input
        id="pub-site-tagline"
        value={value.description}
        maxLength={300}
        onChange={(e) => setValue({ ...value, description: e.target.value })}
      />
      <Label htmlFor="pub-site-author">Author name</Label>
      <Input
        id="pub-site-author"
        value={value.author}
        required
        maxLength={160}
        onChange={(e) => setValue({ ...value, author: e.target.value })}
      />
      <Label htmlFor="pub-site-theme">Theme</Label>
      <select
        className="pub-select"
        id="pub-site-theme"
        value={value.theme}
        onChange={(e) => setValue({ ...value, theme: e.target.value as SiteData["theme"] })}
      >
        {THEMES.map((theme) => (
          <option key={theme} value={theme}>
            {theme[0]?.toUpperCase()}
            {theme.slice(1)}
          </option>
        ))}
      </select>
      <Label htmlFor="pub-site-language">Language code</Label>
      <Input
        id="pub-site-language"
        value={value.inLanguage}
        required
        placeholder="en-GB"
        onChange={(e) => setValue({ ...value, inLanguage: e.target.value })}
      />
      {error && <p role="alert">{error}</p>}
      <div className="pub-actions">
        <Button type="button" variant="outline" onClick={cancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!online}>
          {label}
        </Button>
      </div>
    </form>
  );
}
export function SiteDialog({
  open,
  close,
  created,
  site,
}: {
  open: boolean;
  close: () => void;
  created?: (url: string) => void;
  site?: StoredSite;
}) {
  const { session, snapshot, workspace } = usePublish();
  const now = new Date();
  return (
    <Dialog
      open={open}
      onOpenChange={(show) => {
        if (!show) close();
      }}
    >
      <DialogContent className="pub-dialog">
        <DialogHeader>
          <DialogTitle>{site ? "Site settings" : "Create a site"}</DialogTitle>
          <DialogDescription>
            {site
              ? "Settings apply to your published pages when saved."
              : "Choose a name and a style. Your new site starts private."}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <SiteFields
            key={site?.url ?? "new"}
            initial={
              site?.data ?? {
                name: "",
                description: "",
                author: session.displayName,
                theme: "paper",
                inLanguage: "en-GB",
                created: now,
                modified: now,
              }
            }
            label={site ? "Save settings" : "Create site"}
            cancel={close}
            submit={(data) => {
              if (site) {
                void workspace.settings(site.url, data);
                close();
              } else {
                const used = snapshot.sites.map(
                  (s) => new URL("./", s.url).pathname.split("/").filter(Boolean).at(-1) ?? "",
                );
                const result = workspace.createSite(uniqueSlug(data.name, used), data);
                created?.(result.url);
              }
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
export function SiteView({
  site,
  pages,
  openPage,
}: {
  site: StoredSite;
  pages: StoredPage[];
  openPage: (url: string) => void;
}) {
  const { workspace, repository } = usePublish();
  const [settings, showSettings] = useState(false);
  const [filter, setFilter] = useState<"all" | "draft" | "published">("all");
  const navigationPages = pages.filter((page) => page.data.kind === "page");
  const visible = pages.filter((page) => filter === "all" || page.data.status === filter);
  function create(kind: PageData["kind"]) {
    const title = kind === "post" ? "Untitled post" : "Untitled page";
    const result = workspace.createPage(site.url, crypto.randomUUID(), {
      title,
      kind,
      status: "draft",
      slug: uniqueSlug(
        title,
        pages.map((p) => p.data.slug),
      ),
      body: "",
      summary: "",
      position: Math.max(-1, ...pages.map((p) => p.data.position)) + 1,
      modified: new Date(),
    });
    openPage(result.url);
  }
  function move(url: string, direction: number) {
    const ordered = navigationPages.map((p) => p.url);
    const from = ordered.indexOf(url);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    [ordered[from], ordered[to]] = [ordered[to] as string, ordered[from] as string];
    void workspace.reorder(site.url, ordered);
  }
  return (
    <>
      <header className="pub-page-header">
        <div>
          <p className="pub-eyebrow">Your site</p>
          <AppHeading>{site.data.name}</AppHeading>
          <p className="pub-muted">{site.data.description || "Make room for your next idea."}</p>
        </div>
        <div className="pub-actions">
          <RequiresOnline>
            <Button variant="outline" onClick={() => showSettings(true)}>
              <Settings2 size={16} aria-hidden="true" />
              Settings
            </Button>
          </RequiresOnline>
          <RequiresOnline>
            <Button onClick={() => create("post")}>
              <Plus size={16} aria-hidden="true" />
              New post
            </Button>
          </RequiresOnline>
          <RequiresOnline>
            <Button variant="outline" onClick={() => create("page")}>
              New page
            </Button>
          </RequiresOnline>
        </div>
      </header>
      {site.data.publicUrl ? (
        <div className="pub-published-banner">
          <span className="pub-status">Public site</span>
          <PublicLink url={new URL("index.html", repository.publicUrl(site)).href} />
        </div>
      ) : (
        <p className="pub-notice">
          Your drafts are private. Publishing creates a separate website that anyone can read.
        </p>
      )}
      <div className="pub-list-header">
        <h3>Pages & posts</h3>
        <fieldset className="pub-filters" aria-label="Filter pages">
          {(["all", "published", "draft"] as const).map((value) => (
            <Button
              size="sm"
              variant={filter === value ? "secondary" : "ghost"}
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "all" ? "All" : value === "draft" ? "Drafts" : "Published"}
            </Button>
          ))}
        </fieldset>
      </div>
      {visible.length ? (
        <ul className="pub-page-list">
          {visible.map((page) => (
            <li key={page.url}>
              <FileText size={20} aria-hidden="true" />
              <div className="pub-page-info">
                <Button variant="link" onClick={() => openPage(page.url)}>
                  {page.data.title}
                </Button>
                <p className="pub-muted">
                  {page.data.kind === "post" ? "Post" : "Page"} · /{page.data.slug}/
                </p>
              </div>
              <span className="pub-status" data-state={page.data.status}>
                {page.data.status === "published" ? "Published" : "Draft"}
              </span>
              {page.data.kind === "page" && (
                <div className="pub-actions">
                  <RequiresOnline>
                    <IconButton
                      variant="ghost"
                      label={`Move ${page.data.title} up`}
                      disabled={navigationPages[0]?.url === page.url}
                      onClick={() => move(page.url, -1)}
                    >
                      <ArrowUp size={16} aria-hidden="true" />
                    </IconButton>
                  </RequiresOnline>
                  <RequiresOnline>
                    <IconButton
                      variant="ghost"
                      label={`Move ${page.data.title} down`}
                      disabled={navigationPages.at(-1)?.url === page.url}
                      onClick={() => move(page.url, 1)}
                    >
                      <ArrowDown size={16} aria-hidden="true" />
                    </IconButton>
                  </RequiresOnline>
                </div>
              )}
              {page.data.status === "published" && site.data.publicUrl && (
                <a
                  className="pub-open-page"
                  href={pageUrl({ ...site.data, publicUrl: repository.publicUrl(site) }, page.data)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open published ${page.data.title}`}
                >
                  <ExternalLink size={16} aria-hidden="true" />
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={pages.length ? "No pages in this view" : "Start with a few words"}
          body={
            pages.length
              ? "Choose another filter to see your writing."
              : "Write a post, or add a page such as About. Everything starts as a private draft."
          }
          primaryAction={
            pages.length ? (
              <Button variant="outline" onClick={() => setFilter("all")}>
                Show all pages
              </Button>
            ) : (
              <RequiresOnline>
                <Button onClick={() => create("post")}>Write your first post</Button>
              </RequiresOnline>
            )
          }
        />
      )}
      <SiteDialog open={settings} close={() => showSettings(false)} site={site} />
    </>
  );
}
