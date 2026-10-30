// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { UploadKind, UploadPath } from "./types";
import { hasControls, kind, path, requireValue, segment } from "./validation";

const MAX_NAME_LENGTH = 180;

/** Full extension chain, ignoring leading dots: archive.tar.gz -> .tar.gz. */
function extensionChain(name: string): string {
  const leading = name.length - name.replace(/^\.+/, "").length;
  const dot = name.indexOf(".", leading);
  return dot < 0 ? "" : name.slice(dot);
}

function fitName(name: string, suffix: string, entryKind: UploadKind): string {
  const extension = entryKind === "file" ? extensionChain(name) : "";
  const stem = name.slice(0, name.length - extension.length);
  const available = MAX_NAME_LENGTH - [...extension].length - suffix.length;
  requireValue(available > 0, "invalid-name");
  return [...stem].slice(0, available).join("") + suffix + extension;
}

/** Drive §4.1.3: preserve case/Unicode/spaces, replace reserved characters, trim, cap. */
export function normalizeUploadName(name: string, entryKind: UploadKind = "file"): string {
  segment(name);
  kind(entryKind);
  const cleaned = [...name]
    .map((char) => (hasControls(char) || "/\\:#?%*".includes(char) ? "-" : char))
    .join("")
    .trim();
  const fitted = fitName(cleaned, "", entryKind).trim();
  requireValue(fitted.length > 0 && fitted !== "." && fitted !== "..", "invalid-name");
  // A stem capped to only dots would make later calls reinterpret the extension.
  requireValue(
    entryKind !== "file" || extensionChain(fitted) === extensionChain(cleaned),
    "invalid-name",
  );
  return fitted;
}

/** First free positive suffix, preserving the full extension chain and 180-character cap. */
export function keepBothName(name: string, occupied: readonly string[]): string {
  requireValue(Array.isArray(occupied), "invalid-input");
  for (const item of occupied) segment(item);
  const normalized = normalizeUploadName(name);
  const used = new Set(occupied);
  if (!used.has(normalized)) return normalized;
  let index = 1;
  let candidate: string;
  do {
    candidate = fitName(normalized, ` (${index})`, "file");
    index += 1;
  } while (used.has(candidate));
  return candidate;
}

/** Normalize each decoded segment independently; folders end in a slash. */
export function encodeUploadPath(parts: UploadPath, entryKind: UploadKind): string {
  path(parts);
  kind(entryKind);
  return (
    parts
      .map((part, index) =>
        encodeURIComponent(
          normalizeUploadName(part, index === parts.length - 1 ? entryKind : "folder"),
        ),
      )
      .join("/") + (entryKind === "folder" ? "/" : "")
  );
}
