// AUTHORED-BY Codex (GPT-6.1 Sol)
export function ReadNotice({
  notice,
  scan = false,
}: {
  notice?: { skipped: number; capped: boolean } | undefined;
  scan?: boolean;
}) {
  if (!notice || (!notice.skipped && !notice.capped)) return null;
  return (
    <p className="tr-notice" role="status">
      {scan ? "Some sources skipped. " : "Some saved items could not be loaded. "}
      {notice.skipped} {scan ? "sources or documents" : "documents or pages"} skipped.
      {notice.capped
        ? " The scan limit was reached; these are partial results."
        : " Showing the items that could be read."}
    </p>
  );
}
