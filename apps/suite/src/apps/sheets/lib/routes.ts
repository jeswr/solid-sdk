// AUTHORED-BY Codex GPT-6.1-Sol
import { encodeRef } from "@/lib/refs";

export const workbookHref = (container: string) => `/sheets/s/${encodeRef(container)}`;
