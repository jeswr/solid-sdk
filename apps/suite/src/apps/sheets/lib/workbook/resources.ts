// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { WorkbookConflictError } from "../contract";
import { type createSheetStorage, type Precondition, SheetStorageError } from "../model";

export type Storage = ReturnType<typeof createSheetStorage>;

export function hasStatus(error: unknown, status: number): boolean {
  return error instanceof SheetStorageError && error.status === status;
}

export function strongEtag(value: string | null, url: string): string {
  if (value === null || !/^"[^"\r\n]*"$/.test(value))
    throw new TypeError(`Spreadsheet resource has no strong ETag: ${url}`);
  return value;
}

export function resources(storage: Storage) {
  async function etag(url: string, value: string | null): Promise<string> {
    return strongEtag(value ?? (await storage.loadEtag(url)), url);
  }
  return {
    etag,
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
