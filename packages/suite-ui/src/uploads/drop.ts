// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
export interface DropReadOptions {
  /** Counts files and directories together. Defaults to 10,000. */
  maxEntries?: number;
  /** A dropped root has depth zero. Defaults to 32. */
  maxDepth?: number;
  /** Deadline for the whole traversal, including stalled browser callbacks. Defaults to 30s. */
  timeoutMs?: number;
  signal?: AbortSignal;
}
export class DropReadError extends Error {
  override readonly name = "DropReadError";
  readonly code: "limit-exceeded" | "aborted" | "timeout";
  readonly limit: "maxEntries" | "maxDepth" | undefined;
  constructor(code: DropReadError["code"], limit?: DropReadError["limit"]) {
    super(
      code === "limit-exceeded"
        ? "Dropped folder exceeds upload limits"
        : code === "aborted"
          ? "Reading dropped files was cancelled"
          : "Reading dropped files timed out",
    );
    this.code = code;
    this.limit = limit;
  }
}
function bounds(options: DropReadOptions) {
  const limits = {
    maxEntries: options.maxEntries ?? 10_000,
    maxDepth: options.maxDepth ?? 32,
    timeoutMs: options.timeoutMs ?? 30_000,
  };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < (key === "timeoutMs" ? 1 : 0))
      throw new RangeError(`Invalid drop option: ${key}`);
  }
  return limits;
}
function checkAbort(signal: AbortSignal) {
  if (signal.aborted)
    throw signal.reason instanceof DropReadError ? signal.reason : new DropReadError("aborted");
}
/** Abort even when the browser never calls either callback; late callbacks are ignored. */
function readEntry<T>(
  signal: AbortSignal,
  start: (success: (value: T) => void, failure: (error: DOMException) => void) => void,
): Promise<T> {
  checkAbort(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    const finish = (done: () => void) => {
      signal.removeEventListener("abort", abort);
      if (!signal.aborted) done();
    };
    try {
      start(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
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
export async function readDrop(
  captured: ReturnType<typeof captureDrop>,
  options: DropReadOptions = {},
): Promise<DroppedFiles> {
  const limits = bounds(options);
  const controller = new AbortController();
  const { signal } = controller;
  const abort = () => controller.abort(new DropReadError("aborted"));
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const deadline = Date.now() + limits.timeoutMs;
  const timer = setTimeout(() => controller.abort(new DropReadError("timeout")), limits.timeoutMs);
  let count = 0;
  const result: DroppedFiles = { files: [], directories: [] };
  function check() {
    if (Date.now() >= deadline && !signal.aborted) controller.abort(new DropReadError("timeout"));
    checkAbort(signal);
  }
  function capacity(size: number) {
    check();
    if (count + size > limits.maxEntries) throw new DropReadError("limit-exceeded", "maxEntries");
  }
  async function visit(entry: DropEntry, parent: string, depth: number) {
    check();
    if (depth > limits.maxDepth) throw new DropReadError("limit-exceeded", "maxDepth");
    const path = parent + segment(entry.name);
    if (entry.isFile && entry.file) {
      const read = entry.file;
      const file = await readEntry<File>(signal, (resolve, reject) =>
        read.call(entry, resolve, reject),
      );
      check();
      result.files.push({ file, path });
    } else if (entry.isDirectory && entry.createReader) {
      result.directories.push(`${path}/`);
      const reader = entry.createReader();
      // Chromium returns directory contents in batches; an empty batch terminates iteration.
      for (;;) {
        check();
        const children = await readEntry<DropEntry[]>(signal, (resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        capacity(children.length);
        count += children.length;
        if (!children.length) break;
        for (const child of children) await visit(child, `${path}/`, depth + 1);
      }
    } else throw new Error("Unreadable dropped entry");
  }
  try {
    capacity(captured.entries.length + captured.files.length);
    count = captured.entries.length + captured.files.length;
    for (const file of captured.files) {
      check();
      result.files.push({ file, path: segment(file.name) });
    }
    for (const entry of captured.entries) await visit(entry, "", 0);
    check();
    return result;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
export function filesFromPicker(
  files: ArrayLike<File>,
  options: DropReadOptions = {},
): DroppedFiles {
  const limits = bounds(options);
  const deadline = Date.now() + limits.timeoutMs;
  if (options.signal) checkAbort(options.signal);
  if (files.length > limits.maxEntries) throw new DropReadError("limit-exceeded", "maxEntries");
  const result: DroppedFiles = { files: [], directories: [] };
  const directories = new Set<string>();
  for (let index = 0; index < files.length; index++) {
    if (options.signal) checkAbort(options.signal);
    if (Date.now() >= deadline) throw new DropReadError("timeout");
    const file = files[index];
    if (!file) continue;
    const parts = (file.webkitRelativePath || file.name).split("/").map(segment);
    if (parts.length - 1 > limits.maxDepth) throw new DropReadError("limit-exceeded", "maxDepth");
    result.files.push({ file, path: parts.join("/") });
    for (let i = 1; i < parts.length; i++) directories.add(`${parts.slice(0, i).join("/")}/`);
    if (result.files.length + directories.size > limits.maxEntries)
      throw new DropReadError("limit-exceeded", "maxEntries");
  }
  result.directories = [...directories];
  return result;
}
