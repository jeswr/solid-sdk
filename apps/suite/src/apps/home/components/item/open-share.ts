// AUTHORED-BY Codex GPT-6
import { encodeRef } from "../../../../lib/refs";
/** Replace this target with the shell ShareDialog when it lands. */
export function openShare(url: string): string {
  return `/permissions?item=${encodeRef(url)}`;
}
