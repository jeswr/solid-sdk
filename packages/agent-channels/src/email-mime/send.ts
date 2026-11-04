// AUTHORED-BY Codex GPT-6.1-Sol
import { type EmailRenderOptions, emailRenderer } from "../email/render.js";

export type { EmailRenderOptions };
/** MIME has no transport; Gmail and Graph provide their own send entry points. */
export function createEmailRenderer(options: EmailRenderOptions) {
  const { render, validate } = emailRenderer(options);
  return { render, validate };
}
