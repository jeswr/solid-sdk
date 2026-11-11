// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  type PageData,
  pageUrl,
  renderPage,
  type StoredPage,
  type StoredSite,
} from "@jeswr/solid-publish";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
  toast,
} from "@jeswr/suite-ui";
import { Globe2, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeading } from "@/shell/app-frame";
import { useConnectionState } from "@/shell/sync/connection-state";
import { RequiresOnline } from "@/shell/sync/requires-online";
import {
  draftKey,
  type EditorDraft,
  editorDraft,
  editorPage,
  forgetDraft,
  keepDraft,
  recoverDraft,
} from "../lib/editor";
import { usePublish } from "../state/publish-context";
import { PublicLink } from "./site-view";

function deviceStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
export function PageEditor({
  site,
  page,
  pages,
}: {
  site: StoredSite;
  page: StoredPage;
  pages: StoredPage[];
}) {
  const { session, workspace, repository, snapshot } = usePublish();
  const key = draftKey(session.webId, `${session.mode}:${session.storageUrl}`, page.url);
  const [draft, setDraft] = useState<EditorDraft>(() => editorDraft(page.data));
  const initial = useRef(page.data);
  const currentDraft = useRef(draft);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [local, setLocal] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const online = useConnectionState() === "online";
  useEffect(() => {
    const recovered = recoverDraft(deviceStorage(), key, editorDraft(initial.current));
    setDraft(recovered);
    currentDraft.current = recovered;
    setDirty(JSON.stringify(recovered) !== JSON.stringify(editorDraft(initial.current)));
  }, [key]);
  const publicSite = { ...site.data, publicUrl: repository.publicUrl(site) };
  const rendered = useMemo(() => {
    try {
      const view: PageData = { ...page.data, ...draft, keywords: draft.keywords.split(",") };
      if (!draft.image) delete view.image;
      return renderPage(
        { ...site.data, publicUrl: repository.publicUrl(site) },
        view,
        pages.map((p) => p.data),
      );
    } catch {
      return "";
    }
  }, [site, page, draft, pages, repository]);
  function change(field: keyof EditorDraft, value: string) {
    const next = { ...draft, [field]: value };
    currentDraft.current = next;
    setDraft(next);
    setDirty(true);
    setLocal(keepDraft(deviceStorage(), key, next));
    setError("");
  }
  function save(mode: "draft" | "publish", confirmed = false) {
    try {
      const data = editorPage(page.data, draft, new Date());
      if (mode === "publish" && !site.data.publicUrl && !confirmed) {
        setConfirm(true);
        return;
      }
      setConfirm(false);
      setError("");
      const submitted = JSON.stringify(draft);
      void workspace.savePage(site.url, page.url, data, mode, confirmed).then((saved) => {
        if (saved) {
          if (JSON.stringify(currentDraft.current) === submitted) {
            setDirty(false);
            forgetDraft(deviceStorage(), key);
          }
          toast.success(mode === "publish" ? "Published to your pod" : "Draft saved to your pod");
        }
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the page fields before saving.");
    }
  }
  function unpublish() {
    void workspace.savePage(site.url, page.url, page.data, "unpublish").then((saved) => {
      if (saved) toast.success("Page unpublished. It is now a private draft.");
    });
  }
  return (
    <section aria-label="Page editor">
      <header className="pub-page-header">
        <div>
          <p className="pub-eyebrow">
            {page.data.kind === "post" ? "Blog post" : "Website page"} ·{" "}
            {page.data.status === "published" ? "Published" : "Private draft"}
          </p>
          <AppHeading>{page.data.title}</AppHeading>
        </div>
        <div className="pub-actions">
          {page.data.status === "draft" && (
            <RequiresOnline>
              <Button variant="outline" onClick={() => save("draft")}>
                <Save size={16} aria-hidden="true" />
                Save draft
              </Button>
            </RequiresOnline>
          )}
          {(page.data.status === "published" || page.data.published) && (
            <RequiresOnline>
              <Button variant="outline" onClick={unpublish}>
                Unpublish
              </Button>
            </RequiresOnline>
          )}
          <RequiresOnline>
            <Button onClick={() => save("publish")}>
              <Globe2 size={16} aria-hidden="true" />
              {page.data.status === "published" ? "Update" : "Publish"}
            </Button>
          </RequiresOnline>
        </div>
      </header>
      {page.data.status === "published" && site.data.publicUrl && (
        <PublicLink url={pageUrl(publicSite, page.data)} />
      )}
      <p className="pub-muted" role="status">
        {dirty
          ? local
            ? "Draft kept on this device. Save or publish when you're ready."
            : "Device storage is full or unavailable. Keep this tab open until you can save."
          : snapshot.pending
            ? "Saving…"
            : "Your writing is saved to your pod."}
        {!online ? " Reconnect to save to your pod." : ""}
      </p>
      {error && (
        <p className="pub-notice" role="alert">
          {error}
        </p>
      )}
      <div className="pub-editor-toggle">
        <Button
          variant={preview ? "outline" : "secondary"}
          aria-pressed={!preview}
          onClick={() => setPreview(false)}
        >
          Write
        </Button>
        <Button
          variant={preview ? "secondary" : "outline"}
          aria-pressed={preview}
          onClick={() => setPreview(true)}
        >
          Preview
        </Button>
      </div>
      <div className="pub-editor-grid" data-view={preview ? "preview" : "write"}>
        <div className="pub-editor-fields">
          <Label htmlFor="pub-title">Title</Label>
          <Input
            id="pub-title"
            value={draft.title}
            maxLength={200}
            onChange={(e) => change("title", e.target.value)}
          />
          <div className="pub-field-pair">
            <div>
              <Label htmlFor="pub-slug">URL slug</Label>
              <Input
                id="pub-slug"
                value={draft.slug}
                aria-describedby="pub-slug-help"
                onChange={(e) => change("slug", e.target.value)}
              />
              <p id="pub-slug-help" className="pub-muted">
                Lowercase letters, numbers and hyphens.
              </p>
            </div>
            <div>
              <Label htmlFor="pub-keywords">Keywords</Label>
              <Input
                id="pub-keywords"
                value={draft.keywords}
                placeholder="garden, ideas"
                onChange={(e) => change("keywords", e.target.value)}
              />
            </div>
          </div>
          <Label htmlFor="pub-summary">Summary</Label>
          <Textarea
            id="pub-summary"
            rows={2}
            value={draft.summary}
            onChange={(e) => change("summary", e.target.value)}
          />
          <Label htmlFor="pub-body">Markdown</Label>
          <p className="pub-muted" id="pub-markdown-help">
            Use ## for headings, **bold**, [links](https://example.org) and lists.
          </p>
          <Textarea
            id="pub-body"
            className="pub-markdown"
            rows={20}
            value={draft.body}
            aria-describedby="pub-markdown-help"
            spellCheck
            onChange={(e) => change("body", e.target.value)}
          />
          <Label htmlFor="pub-image">Preview image URL (optional)</Label>
          <Input
            id="pub-image"
            type="url"
            value={draft.image}
            placeholder="https://example.org/image.jpg"
            onChange={(e) => change("image", e.target.value)}
          />
        </div>
        <div className="pub-preview">
          <div className="pub-preview-heading">
            <h3>Live preview</h3>
            <span>Same HTML as your public page</span>
          </div>
          {rendered ? (
            <iframe
              title="Published page preview"
              sandbox=""
              srcDoc={rendered}
              referrerPolicy="no-referrer"
            />
          ) : (
            <p role="status" className="pub-notice">
              Enter a valid URL slug to see your preview.
            </p>
          )}
        </div>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make this site public?</DialogTitle>
            <DialogDescription>
              Anyone with the public URL will be able to read your published pages. Your Markdown
              sources and drafts stay private in your pod. Copies already made by readers cannot be
              recalled.
            </DialogDescription>
          </DialogHeader>
          <div className="pub-actions">
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Keep private
            </Button>
            <Button disabled={!online} onClick={() => save("publish", true)}>
              Publish publicly
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
