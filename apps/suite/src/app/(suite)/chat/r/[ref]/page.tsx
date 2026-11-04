// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { RoomPageRoute } from "@/apps/chat/components/room";

// Staging sets this literal to false; the web target retains on-demand routes.
export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ ref: "__" }] : [];
}

/** RoomPageRoute reads the ref from the pathname, so the native placeholder serves every room. */
export default function RoomPage() {
  return <RoomPageRoute />;
}
