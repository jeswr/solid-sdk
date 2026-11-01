// AUTHORED-BY Codex GPT-6.1-Sol
import { ResourceWriteError } from "../../../docs/lib/model/errors";

export { OutOfScopeError } from "../../../docs/lib/model/errors";

export class NoteConflictError extends ResourceWriteError {
  constructor(url: string, options?: ErrorOptions) {
    super(url, 412, options);
    this.name = "NoteConflictError";
  }
}
