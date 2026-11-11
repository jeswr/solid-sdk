// AUTHORED-BY Codex GPT-6
export function DiaryReadNote({ count }: { count: number }) {
  return count ? (
    <p className="hlt-muted" role="status">
      {count} {count === 1 ? "entry" : "entries"} couldn't be read.
    </p>
  ) : null;
}
