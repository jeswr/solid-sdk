// AUTHORED-BY Codex (GPT-6.1 Sol)
import { type PageData, validatePage } from "@jeswr/solid-publish";
export interface EditorDraft {
  title: string;
  slug: string;
  body: string;
  summary: string;
  image: string;
  keywords: string;
}
export function editorDraft(page: PageData): EditorDraft {
  return {
    title: page.title,
    slug: page.slug,
    body: page.body,
    summary: page.summary,
    image: page.image ?? "",
    keywords: (page.keywords ?? []).join(", "),
  };
}
export function editorPage(page: PageData, draft: EditorDraft, at: Date): PageData {
  if (draft.image && !/^https?:\/\//.test(draft.image))
    throw new TypeError("The image URL must start with https:// or http://.");
  const data: PageData = {
    ...page,
    ...draft,
    keywords: draft.keywords
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean),
    modified: at,
  };
  if (!draft.image) delete data.image;
  return validatePage(data);
}
const FIELDS = ["title", "slug", "body", "summary", "image", "keywords"] as const;
export function draftKey(webId: string, root: string, page: string): string {
  return `publish:editor:1:${JSON.stringify([webId, root, page])}`;
}
export function recoverDraft(
  storage: Pick<Storage, "getItem"> | undefined,
  key: string,
  fallback: EditorDraft,
): EditorDraft {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return fallback;
    const envelope: unknown = JSON.parse(raw);
    if (
      !envelope ||
      typeof envelope !== "object" ||
      !("key" in envelope) ||
      envelope.key !== key ||
      !("draft" in envelope)
    )
      return fallback;
    const draft = envelope.draft as EditorDraft;
    if (!draft || !FIELDS.every((field) => typeof draft[field] === "string")) return fallback;
    return Object.fromEntries(
      FIELDS.map((field) => [field, draft[field]]),
    ) as unknown as EditorDraft;
  } catch {
    return fallback;
  }
}
export function keepDraft(
  storage: Pick<Storage, "setItem"> | undefined,
  key: string,
  draft: EditorDraft,
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify({ key, draft }));
    return true;
  } catch {
    return false;
  }
}
export function forgetDraft(storage: Pick<Storage, "removeItem"> | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    /* A failed cache cleanup must not undo a pod save. */
  }
}
