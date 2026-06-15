// AUTHORED-BY Claude Opus 4.8
/**
 * Pod-shaped path conventions for Pod Mail.
 *
 * Mail data lives under a single app root container in the pod (default
 * `<podRoot>mail/`). Within it: one document per folder, plus a `messages/`
 * container holding one resource per message and a `threads/` container for
 * thread documents. Containers end in `/` (LDP convention). For data only Pod
 * Mail touches we derive paths from the pod root — only the primary class goes
 * into the type index for cross-app discovery.
 */

/** Ensure a container URL ends in a single trailing slash. */
export function asContainer(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** The app's mail root container under a pod root. */
export function mailRoot(podRoot: string): string {
  return new URL("mail/", asContainer(podRoot)).toString();
}

/** The container holding individual message resources. */
export function messagesContainer(podRoot: string): string {
  return new URL("messages/", mailRoot(podRoot)).toString();
}

/** The container holding thread documents. */
export function threadsContainer(podRoot: string): string {
  return new URL("threads/", mailRoot(podRoot)).toString();
}

/**
 * The document for a named folder (e.g. "inbox" → `<mail>/folders/inbox.ttl`).
 * The slug is URL-encoded (as for message/thread ids) so a name containing
 * `../`, `#`, `?` or spaces cannot escape the `folders/` namespace or address an
 * unexpected resource.
 */
export function folderDocument(podRoot: string, folder: string): string {
  return new URL(`folders/${encodeURIComponent(folder)}.ttl`, mailRoot(podRoot)).toString();
}

/**
 * The document for a single message by id. Message ids are app-minted opaque
 * slugs; the caller owns id generation (e.g. a UUID).
 */
export function messageDocument(podRoot: string, id: string): string {
  return new URL(`${encodeURIComponent(id)}.ttl`, messagesContainer(podRoot)).toString();
}

/** The document for a single thread by id. */
export function threadDocument(podRoot: string, id: string): string {
  return new URL(`${encodeURIComponent(id)}.ttl`, threadsContainer(podRoot)).toString();
}
