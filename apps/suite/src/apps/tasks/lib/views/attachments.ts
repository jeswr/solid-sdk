// AUTHORED-BY Codex GPT-6.1-Sol
import { hrefFor } from "../../../drive/lib/files/urls";
import type { StoredTask } from "../model/store";

/** Separate attachment projection keeps the shared TaskView contract unchanged. */
export function attachmentCount(stored: StoredTask | undefined): number {
  return stored?.task.attachments.length ?? 0;
}

export function attachmentViews(stored: StoredTask, storageUrl?: string) {
  return stored.task.attachments.map((url) => attachmentView(url, storageUrl));
}

export function attachmentView(url: string, storageUrl?: string) {
  const resource = new URL(url);
  const segment = resource.pathname.split("/").filter(Boolean).at(-1);
  let name = segment ?? resource.hostname;
  try {
    name = decodeURIComponent(name);
  } catch {
    // A malformed percent escape is still useful as a literal file name.
  }
  const storage = storageUrl ? new URL(storageUrl) : undefined;
  const inPod =
    storage &&
    resource.origin === storage.origin &&
    resource.pathname.startsWith(`${storage.pathname.replace(/\/$/, "")}/`);
  return {
    url,
    name,
    href: inPod ? hrefFor({ url, kind: resource.pathname.endsWith("/") ? "folder" : "file" }) : url,
  };
}
