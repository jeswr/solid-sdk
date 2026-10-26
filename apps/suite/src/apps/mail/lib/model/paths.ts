// AUTHORED-BY Codex GPT-6.1-Sol
import {
  accountRoot,
  attachmentPath,
  documentSlug,
  systemFolderSlug,
} from "@jeswr/pod-connectors/mail";
/** Existing pod-mail layout, with an explicit account segment for new imports. */
export function mailRoot(storage: string, account: string): string {
  const root = new URL(storage);
  if (
    !["http:", "https:"].includes(root.protocol) ||
    root.username ||
    root.password ||
    root.search ||
    root.hash
  ) {
    throw new TypeError("Invalid storage URL");
  }
  if (!account.trim() || account === "." || account === "..")
    throw new TypeError("Invalid account");
  if (!root.pathname.endsWith("/")) root.pathname += "/";
  return new URL(accountRoot(account), root).href;
}
export function mailDocument(
  root: string,
  kind: "messages" | "threads" | "folders",
  id: string,
): string {
  if (!id.trim()) throw new TypeError("Empty mail identifier");
  return new URL(documentSlug(kind, id), root).href;
}
/** A literal colon reserves system keys; custom label colons are escaped by pathId. */
export function systemFolderDocument(root: string, id: string): string {
  return new URL(systemFolderSlug(id), root).href;
}
export function attachmentUrl(storage: string, account: string, id: string, index: number): string {
  // Names from MIME are metadata, never paths.
  return new URL(
    attachmentPath(account, id, index),
    storage.endsWith("/") ? storage : `${storage}/`,
  ).href;
}
