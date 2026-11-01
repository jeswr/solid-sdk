// AUTHORED-BY Codex GPT-6.1-Sol

import { ChatModelError } from "./validation";

/**
 * Read an ACL target using RFC 8288 Link field grammar. Commas and semicolons in
 * URI references or quoted strings are data; parameter order is insignificant.
 * First rel wins. Anchored links describe another context and are ignored.
 * Malformed fields fail closed before any ACL write.
 */
export function aclLink(header: string | null): string | undefined {
  let remaining = (header ?? "").trim();
  while (remaining) {
    // Empty list members are allowed in HTTP list fields.
    if (remaining.startsWith(",")) {
      remaining = remaining.slice(1).trimStart();
      continue;
    }
    const target = /^<([^<>\s]*)>/.exec(remaining);
    if (!target) throw new ChatModelError("invalid-input");
    remaining = remaining.slice(target[0].length).trimStart();
    const parameters = new Map<string, string>();
    while (remaining.startsWith(";")) {
      const parameter =
        /^;[ \t]*([!#$%&'*+\-.^_`|~\da-z]+)[ \t]*(?:=[ \t]*(?:"((?:[^"\\\r\n]|\\[^\r\n])*)"|([!#$%&'*+\-.^_`|~\da-z]+)))?[ \t]*/i.exec(
          remaining,
        );
      if (!parameter) throw new ChatModelError("invalid-input");
      const name = (parameter[1] as string).toLowerCase();
      const value = (parameter[2] ?? parameter[3] ?? "").replace(/\\(.)/g, "$1");
      if (!parameters.has(name)) parameters.set(name, value);
      remaining = remaining.slice(parameter[0].length);
    }
    if (remaining && !remaining.startsWith(",")) throw new ChatModelError("invalid-input");
    if (
      !parameters.has("anchor") &&
      parameters
        .get("rel")
        ?.toLowerCase()
        .split(/[ \t]+/)
        .includes("acl")
    )
      return target[1];
  }
  return undefined;
}
