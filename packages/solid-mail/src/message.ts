// AUTHORED-BY Codex (GPT-6.1 Sol)
import { entities } from "./generated/model.js";
import { publicWrapper } from "./wrapper.js";

/** Generated live fields; the facade keeps read-state policy and the original name. */
export class Message extends publicWrapper(entities.Message.Wrapper) {
  markMessage(): void {
    this.mark();
  }
  get isRead(): boolean {
    return this.dateRead !== undefined;
  }
  setRead(read: boolean, at: Date = new Date()): void {
    this.dateRead = read ? at : undefined;
  }
}
