// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { WorkbookConflictError, WorkbookPartialSaveError, type WorkbookVersion } from "../contract";
import {
  type createSheetStorage,
  type Precondition,
  SheetStorageError,
  type Snapshot,
  type WorkbookMetadata,
  workbookLayout,
} from "../model";

export type Storage = ReturnType<typeof createSheetStorage>;

export function hasStatus(error: unknown, status: number): boolean {
  return error instanceof SheetStorageError && error.status === status;
}

export function strongEtag(value: string | null, url: string): string {
  if (value === null || !/^"[^"\r\n]*"$/.test(value))
    throw new TypeError(`Spreadsheet resource has no strong ETag: ${url}`);
  return value;
}

/** Canonical JSON comparison: object key order is irrelevant, array order is preserved. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

export function resources(storage: Storage) {
  async function etag(url: string, value: string | null): Promise<string> {
    return strongEtag(value ?? (await storage.loadEtag(url)), url);
  }
  async function snapshotEtag(container: string, expected: Snapshot, value: string | null) {
    if (value !== null) return strongEtag(value, workbookLayout(container).snapshot);
    const stored = await storage.loadSnapshot(container);
    if (canonical(stored.value) !== canonical(expected)) throw new WorkbookConflictError(container);
    return strongEtag(stored.etag, workbookLayout(container).snapshot);
  }
  async function indexEtag(container: string, expected: WorkbookMetadata, value: string | null) {
    if (value !== null) return strongEtag(value, workbookLayout(container).index);
    const stored = await storage.loadIndex(container);
    if (canonical(stored.value) !== canonical(expected)) throw new WorkbookConflictError(container);
    return strongEtag(stored.etag, workbookLayout(container).index);
  }
  return {
    etag,
    snapshotEtag,
    indexEtag,
    async verify(container: string, base: WorkbookVersion): Promise<WorkbookVersion> {
      let { snapshotEtag: snapshot, indexEtag: index } = base;
      const pending = { ...base.pendingVerification };
      try {
        if (pending.snapshot) {
          snapshot = await snapshotEtag(container, pending.snapshot, null);
          delete pending.snapshot;
        }
        if (pending.index) {
          index = await indexEtag(container, pending.index, null);
          delete pending.index;
        }
      } catch (error) {
        if (error instanceof WorkbookConflictError) throw error;
        throw new WorkbookPartialSaveError(
          { ...base, snapshotEtag: snapshot, indexEtag: index, pendingVerification: pending },
          error,
        );
      }
      return { snapshotEtag: snapshot, indexEtag: index, derived: base.derived };
    },
    async authoritative(container: string, write: () => Promise<string | null>) {
      try {
        return await write();
      } catch (error) {
        if (hasStatus(error, 412)) throw new WorkbookConflictError(container);
        throw error;
      }
    },
    async derived(url: string, write: () => Promise<string | null>): Promise<string | undefined> {
      let result: string | null;
      try {
        result = await write();
      } catch (cause) {
        throw new Error(`Could not write spreadsheet resource: ${url}`, { cause });
      }
      // Projections are unguarded and repairable; validator discovery is best effort.
      return etag(url, result).catch(() => undefined);
    },
    async remove(url: string, condition?: Precondition): Promise<void> {
      try {
        await storage.deleteResource(url, condition);
      } catch (cause) {
        throw new Error(`Could not delete spreadsheet resource: ${url}`, { cause });
      }
    },
  };
}
