// AUTHORED-BY Codex GPT-6.1-Sol
import { IntegrationSyncError } from "./errors.js";

/** Fail closed when an API promises another page without advancing its cursor. */
export class Pagination {
  private readonly seen = new Set<string>();
  constructor(private readonly adapterId: string) {}
  next(cursor: string | null | undefined): string {
    if (!cursor || this.seen.has(cursor)) {
      throw new IntegrationSyncError(
        this.adapterId,
        "The platform returned a missing or repeated page cursor.",
      );
    }
    this.seen.add(cursor);
    return cursor;
  }
}
