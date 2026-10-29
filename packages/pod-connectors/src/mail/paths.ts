// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * The pod-mail layout (apps MAI-01 `paths.ts`), relative to the connector container:
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

export function accountRoot(account: string): string {
  return `mail/${pathId(nonEmpty(account, "account"))}/`;
}

export function messageSlug(account: string, id: string): string {
  return `${accountRoot(account)}messages/${pathId(nonEmpty(id, "message id"))}.ttl`;
}

export function emlSlug(account: string, id: string): string {
  return messageSlug(account, id).replace(/\.ttl$/, ".eml");
}

export function threadSlug(account: string, key: string): string {
  return `${accountRoot(account)}threads/${pathId(nonEmpty(key, "thread id"))}.ttl`;
}

/** System folders use the reserved literal `system:` prefix; custom label colons are escaped. */
export function folderSlug(account: string, title: string): string {
  const system = (SYSTEM_FOLDERS as readonly string[]).includes(title);
  return system
    ? `${accountRoot(account)}folders/system:${pathId(title.toLowerCase())}.ttl`
    : `${accountRoot(account)}folders/${pathId(nonEmpty(title, "folder"))}.ttl`;
}

/** MIME file names are metadata, never paths. */
export function attachmentSlug(account: string, id: string, index: number): string {
  return `mail/attachments/${pathId(nonEmpty(account, "account"))}/${pathId(id)}-${index}`;
}
