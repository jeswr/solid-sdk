// AUTHORED-BY Codex GPT-6.2-Astra
// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { WorkbookLinkError } from "../contract";
import { workbookLayout } from "../model";

export function directChild(root: string, url: string): boolean {
  const child = new URL(url);
  return (
    child.href !== root &&
    !child.search &&
    !child.hash &&
    new URL(child.pathname.endsWith("/") ? "../" : "./", child).href === root
  );
}

export function assertWorkbook(root: string, container: string): string {
  const url = workbookLayout(container).container;
  assertWithinPodScope(root, url);
  if (!directChild(root, url)) throw new TypeError("Workbook must be a direct child of Sheets");
  return url;
}

/** A shared workbook is <owner pod>/sheets/<workbook>/ on the reader's storage origin. */
export function assertSharedWorkbook(root: string, container: string): string {
  try {
    const url = workbookLayout(container).container;
    if (
      url !== container ||
      /[%?#]/.test(container) ||
      !/^\/(?:[^/]+\/)+sheets\/[^/]+\/$/.test(new URL(url).pathname)
    )
      throw new WorkbookLinkError();
    return assertWithinPodScope(new URL("/", root).href, url);
  } catch {
    throw new WorkbookLinkError();
  }
}

/** The two authoritative files read by openShared. Derived sheets and comments need no grant. */
export function sharedWorkbookFiles(container: string) {
  const { index, snapshot } = workbookLayout(container);
  return [index, snapshot];
}

export function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 60)
      .replace(/^-+|-+$/g, "") || "spreadsheet"
  );
}
