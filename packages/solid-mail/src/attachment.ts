// AUTHORED-BY Codex (GPT-6.1 Sol)
import { entities } from "./generated/model.js";
import { publicWrapper } from "./wrapper.js";

/** Generated metadata view over the stored binary IRI; wrapping never adds a type. */
export class Attachment extends publicWrapper(entities.Attachment.Wrapper) {}
