// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { FileError, validString } from "./errors";

export const MAX_RESOURCE_NAME_LENGTH = 180;

/** Everything after the first non-leading dot; dotfiles have a stem. */
export function extensionChain(name: string): string {
  validString(name, "invalid-name");
  const dot = name.indexOf(".", name.startsWith(".") ? 1 : 0);
  return dot < 0 ? "" : name.slice(dot);
}

function fitName(name: string, suffix: string): string {
  const extension = extensionChain(name);
  const stem = Array.from(name.slice(0, name.length - extension.length));
  const available = MAX_RESOURCE_NAME_LENGTH - Array.from(extension + suffix).length;
  if (available < 1) throw new FileError("name-too-long");
  return (stem.slice(0, available).join("") + suffix + extension).trim();
}

/** Display-fidelity upload policy from Drive §4.1.3; input is a name, never a URL. */
export function uploadFileName(input: string): string {
  validString(input, "invalid-name");
  const name = input
    .normalize("NFC")
    .replace(/[/\\:#?%*\p{Cc}]/gu, "-")
    .trim();
  const fittedName = fitName(name, "");
  if (!fittedName || fittedName === "." || fittedName === "..") throw new FileError("invalid-name");
  return fittedName;
}

/** One percent-encoded LDP Slug/path segment, with exactly one encoding pass. */
export function encodeResourceName(input: string): string {
  return encodeURIComponent(uploadFileName(input));
}

/** Insert a positive conflict number before the complete extension chain. */
export function withSuffix(input: string, number: number): string {
  if (!Number.isSafeInteger(number) || number < 1) throw new FileError("invalid-name");
  return fitName(uploadFileName(input), ` (${number})`);
}

/** Pick the first free name from a snapshot; this does not reserve a server name. */
export function renameOnConflict(input: string, existingNames: readonly string[]): string {
  const name = uploadFileName(input);
  const occupied = new Set(
    existingNames.map((existing) => {
      validString(existing, "invalid-name");
      return existing.normalize("NFC");
    }),
  );
  let candidate = name;
  let number = 0;
  while (occupied.has(candidate)) {
    number += 1;
    candidate = withSuffix(name, number);
  }
  return candidate;
}
