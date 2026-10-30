// AUTHORED-BY Codex
/** Rich/plain text representations take precedence over their binary image fallback. */
export function imageTransferFile(transfer: DataTransfer | null): File | undefined {
  if (transfer?.getData("text/html") || transfer?.getData("text/plain")) return undefined;
  return [...(transfer?.files ?? [])].find((file) => file.type.startsWith("image/"));
}
