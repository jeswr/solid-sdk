// AUTHORED-BY Codex GPT-6.1-Sol
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
    async derived(
      url: string,
      known: string | undefined,
      write: (condition: Precondition) => Promise<string | null>,
    ): Promise<string> {
      try {
        let result: string | null;
        try {
          result = await write(known === undefined ? { ifNoneMatch: "*" } : { ifMatch: known });
        } catch (error) {
          if (known !== undefined || !hasStatus(error, 412)) throw error;
          result = await write({ ifMatch: await etag(url, null) });
        }
        return await etag(url, result);
      } catch (cause) {
        throw new Error(`Could not write spreadsheet resource: ${url}`, { cause });
      }
    },
    async remove(url: string): Promise<void> {
      try {
        await storage.deleteResource(url);
      } catch (cause) {
        throw new Error(`Could not delete spreadsheet resource: ${url}`, { cause });
      }
    },
  };
}
