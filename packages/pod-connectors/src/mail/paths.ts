// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * The shared MAI-01 layout, relative to a storage or connector root:
 * `mail/<account>/{messages,threads,folders}/<id>.ttl`, the `.eml` beside each message,
 * and attachments under `mail/attachments/<account>/<id>-<n>`.
 */

/** Reversible escaping without percent-encoded delimiters (MAI-01 `pathId`). */
export function pathId(value: string): string {
  return encodeURIComponent(value).replace(/~/g, "%7E").replace(/%/g, "~");
}

function nonEmpty(value: string, what: string): string {
  if (!value.trim() || value === "." || value === "..") throw new TypeError(`Invalid ${what}`);
  return value;
}

export const SYSTEM_FOLDERS = ["Inbox", "Sent", "Drafts", "Trash", "Archive", "Starred"] as const;

/** Relative to an account root; callers retain their own identifier validation. */
export function documentSlug(kind: "messages" | "threads" | "folders", id: string): string {
  return `${kind}/${pathId(id)}.ttl`;
}

/** Relative to an account root; the caller supplies the system key (usually lowercase). */
export function systemFolderSlug(id: string): string {
  return `folders/system:${pathId(id)}.ttl`;
}

/** Relative layout only; attachmentSlug additionally validates the connector account. */
export function attachmentPath(account: string, id: string, index: number): string {
  return `mail/attachments/${pathId(account)}/${pathId(id)}-${index}`;
}

export function accountRoot(account: string): string {
  return `mail/${pathId(nonEmpty(account, "account"))}/`;
}

export function messageSlug(account: string, id: string): string {
  return `${accountRoot(account)}${documentSlug("messages", nonEmpty(id, "message id"))}`;
}

export function emlSlug(account: string, id: string): string {
  return messageSlug(account, id).replace(/\.ttl$/, ".eml");
}

export function threadSlug(account: string, key: string): string {
  return `${accountRoot(account)}${documentSlug("threads", nonEmpty(key, "thread id"))}`;
}

/** System folders use the reserved literal `system:` prefix; custom label colons are escaped. */
export function folderSlug(account: string, title: string): string {
  const system = (SYSTEM_FOLDERS as readonly string[]).includes(title);
  return system
    ? `${accountRoot(account)}${systemFolderSlug(title.toLowerCase())}`
    : `${accountRoot(account)}${documentSlug("folders", nonEmpty(title, "folder"))}`;
}

/** MIME file names are metadata, never paths. */
export function attachmentSlug(account: string, id: string, index: number): string {
  return attachmentPath(nonEmpty(account, "account"), id, index);
}
