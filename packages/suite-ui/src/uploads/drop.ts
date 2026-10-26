// AUTHORED-BY Codex GPT-6.1-Sol
export interface DroppedFile {
  file: File;
  path: string;
}
export interface DroppedFiles {
  files: DroppedFile[];
  directories: string[];
}
/** Minimal browser entry contract, also usable by adapters and deterministic tests. */
export interface DropEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, failure: (error: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: DropEntry[]) => void,
      failure: (error: DOMException) => void,
    ) => void;
  };
}
export interface DropItem {
  kind: string;
  webkitGetAsEntry?: () => DropEntry | null;
  getAsFile: () => File | null;
}
function segment(name: string): string {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes(String.fromCharCode(0))
  )
    throw new Error("Invalid dropped path");
  return name;
}
/** Capture entries/files synchronously: the browser clears DataTransfer after the event. */
export function captureDrop(
  items: ArrayLike<DropItem>,
  fallback: ArrayLike<File>,
): { entries: DropEntry[]; files: File[] } {
  const entries: DropEntry[] = [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (!entries.length && !files.length) files.push(...Array.from(fallback));
  return { entries, files };
}
export async function readDrop(captured: ReturnType<typeof captureDrop>): Promise<DroppedFiles> {
  const result: DroppedFiles = {
    files: captured.files.map((file) => ({ file, path: segment(file.name) })),
    directories: [],
  };
  async function visit(entry: DropEntry, parent: string) {
    const path = parent + segment(entry.name);
    if (entry.isFile && entry.file) {
      const read = entry.file;
      const file = await new Promise<File>((resolve, reject) => read.call(entry, resolve, reject));
      result.files.push({ file, path });
    } else if (entry.isDirectory && entry.createReader) {
      result.directories.push(`${path}/`);
      const reader = entry.createReader();
      // Chromium returns directory contents in batches; an empty batch terminates iteration.
      for (;;) {
        const children = await new Promise<DropEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!children.length) break;
        for (const child of children) await visit(child, `${path}/`);
      }
    } else throw new Error("Unreadable dropped entry");
  }
  for (const entry of captured.entries) await visit(entry, "");
  return result;
}
export function filesFromPicker(files: ArrayLike<File>): DroppedFiles {
  const result: DroppedFiles = { files: [], directories: [] };
  const directories = new Set<string>();
  for (const file of Array.from(files)) {
    const parts = (file.webkitRelativePath || file.name).split("/").map(segment);
    result.files.push({ file, path: parts.join("/") });
    for (let i = 1; i < parts.length; i++) directories.add(`${parts.slice(0, i).join("/")}/`);
  }
  result.directories = [...directories];
  return result;
}
