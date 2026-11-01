// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ group: "__" }] : [];
}

// The persistent layout owns the list and detail so keyboard focus survives navigation.
export default function ContactsPage() {
  return null;
}
