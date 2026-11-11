// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { ResourceWriteError } from "../../../docs/lib/model/errors";

export { OutOfScopeError } from "../../../docs/lib/model/errors";

export class NoteConflictError extends ResourceWriteError {
  constructor(url: string, options?: ErrorOptions) {
    super(url, 412, options);
    this.name = "NoteConflictError";
  }
}

/** Fence permission hints from reads started before the denied write. */
export class NotePermissionError extends ResourceWriteError {
  constructor(
    url: string,
    readonly localGeneration: number,
    cause: unknown,
  ) {
    super(url, 403, { cause });
  }
}

export class NoteMoveUncertainError extends Error {
  constructor(
    readonly source: string,
    readonly destination: string,
    options: ErrorOptions,
  ) {
    super(
      "Couldn't verify the move. The note may exist twice; both copies have been kept.",
      options,
    );
    this.name = "NoteMoveUncertainError";
  }
}
