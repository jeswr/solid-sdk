// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { ThreadRoute } from "@/apps/mail/components/views";

// Staging sets this literal to false; the web target retains on-demand routes.
export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ ref: "__" }] : [];
}

/** ThreadRoute reads the ref from the pathname, so the native placeholder serves every thread. */
export default function Page() {
  return <ThreadRoute />;
}
