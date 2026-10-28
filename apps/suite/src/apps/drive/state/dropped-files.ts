// AUTHORED-BY Claude Opus 5.5

/** A dropped file and its slash-separated path inside the drop, e.g. `Reports/q3/a.txt`. */
export interface DroppedFile {
  readonly file: File;
  readonly path: string;
}

type Pending = { readonly entry: FileSystemEntry } | { readonly file: File };

/**
 * Reads the files of a drop, walking dropped folders so their structure is kept
 * (04-drive §4.1 folder upload via `webkitGetAsEntry`). The entries are taken
 * synchronously because a DataTransfer empties once its drop event returns; the
 * walk itself finishes later. Browsers without entries upload the flat file list.
 */
export function readDrop(data: DataTransfer): Promise<DroppedFile[]> {
  const pending: Pending[] = [];
  for (const item of data.items ? [...data.items] : []) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) pending.push({ entry });
    else {
      const file = item.getAsFile();
      if (file) pending.push({ file });
    }
  }
  if (!pending.some((source) => "entry" in source && source.entry.isDirectory)) {
    return Promise.resolve([...data.files].map((file) => ({ file, path: file.name })));
  }
  return Promise.all(
    pending.map((source) =>
      "file" in source ? [{ file: source.file, path: source.file.name }] : walk(source.entry, ""),
    ),
  ).then((groups) => groups.flat());
}

async function walk(entry: FileSystemEntry, prefix: string): Promise<DroppedFile[]> {
  if (isFile(entry)) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
    return [{ file, path: `${prefix}${file.name}` }];
  }
  const children = await readAll((entry as FileSystemDirectoryEntry).createReader());
  const nested = await Promise.all(children.map((child) => walk(child, `${prefix}${entry.name}/`)));
  return nested.flat();
}

function isFile(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile;
}

/** `readEntries` returns at most one batch (100 in Chromium) per call; read until empty. */
async function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const entries: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return entries;
    entries.push(...batch);
  }
}
