// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

// Staging sets this literal to false; the web target retains on-demand routes.
export const dynamicParams = true;
export function generateStaticParams() {
  // The native export has one placeholder page; the layout reads the real path on the client.
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ ref: "__" }] : [];
}
/** The persistent layout selects the list and dialog from the current route. */
export default function NotesPage() {
  return null;
}
