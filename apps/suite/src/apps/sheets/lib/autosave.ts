// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
export type SaveStatus = "saved" | "saving" | "unsaved" | "offline" | "conflict" | "error";

export interface AutosaveOptions<T> {
  save(value: T, force: boolean): Promise<void>;
  onStatus(status: SaveStatus): void;
  isConflict(error: unknown): boolean;
  online: boolean;
  delay?: number;
}

/** One writer per workbook. Failures retain the latest edit until explicit retry. */
export function createAutosave<T>(options: AutosaveOptions<T>) {
  let pending: (() => T) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let online = options.online;
  let blocked: "conflict" | "error" | undefined;
  let force = false;
  let status: SaveStatus = online ? "saved" : "offline";
  const report = (next: SaveStatus) => {
    status = next;
    options.onStatus(next);
  };
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const fail = (error: unknown) => {
    blocked = options.isConflict(error) ? "conflict" : "error";
    report(online ? blocked : "offline");
  };

  function flush(): Promise<void> {
    clear();
    // Materialize before waiting: the engine may be disposed immediately after teardown.
    if (pending) {
      try {
        const value = pending();
        pending = () => value;
      } catch (error) {
        fail(error);
        return Promise.resolve();
      }
    }
    if (inFlight) return inFlight.then(flush);
    if (!pending || !online || blocked) return Promise.resolve();
    const read = pending;
    pending = undefined;
    const overwrite = force;
    force = false;
    report("saving");
    const operation = Promise.resolve()
      .then(() => options.save(read(), overwrite))
      .then(
        () => report(online ? (blocked ?? (pending ? "unsaved" : "saved")) : "offline"),
        (error: unknown) => {
          pending ??= read;
          fail(error);
        },
      );
    inFlight = operation;
    return operation.then(() => {
      inFlight = undefined;
      if (pending && !timer && online && !blocked) return flush();
    });
  }

  return {
    get dirty() {
      return Boolean(pending || inFlight);
    },
    get status() {
      return status;
    },
    schedule(read: () => T) {
      pending = read;
      clear();
      report(online ? (blocked ?? "unsaved") : "offline");
      if (online && !blocked) timer = setTimeout(() => void flush(), options.delay ?? 1000);
    },
    flush,
    retry(overwrite = false) {
      blocked = undefined;
      force = overwrite && Boolean(pending);
      return flush();
    },
    setOnline(value: boolean) {
      online = value;
      if (!online) {
        clear();
        report("offline");
      } else if (blocked === "conflict") {
        report("conflict");
      } else {
        blocked = undefined;
        report(pending ? "unsaved" : inFlight ? "saving" : "saved");
        void flush();
      }
    },
    /** Discard local edits only after choosing to load another version or delete. */
    reset() {
      clear();
      pending = undefined;
      blocked = undefined;
      force = false;
      report(online ? "saved" : "offline");
    },
  };
}
