// AUTHORED-BY Codex (GPT-6.1 Sol)
import { entities } from "./generated/model.js";
import { Classes } from "./vocab.js";
import { publicWrapper } from "./wrapper.js";

/** Generated fields plus the existing SIOC alignment and membership conveniences. */
export class Thread extends publicWrapper(entities.Thread.Wrapper) {
  markThread(): void {
    this.mark();
    // Co-type on write, not a read alias: SIOC-only subjects remain unenumerated.
    this.types.add(Classes.SiocThread);
  }
  addMessage(messageIri: string): void {
    this.messageIris.add(messageIri);
  }
  removeMessage(messageIri: string): void {
    this.messageIris.delete(messageIri);
  }
  get size(): number {
    return this.messageIris.size;
  }
}
