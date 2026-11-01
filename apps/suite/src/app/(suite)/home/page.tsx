// AUTHORED-BY Claude Opus 5.5
import { HomePage } from "@/apps/home/components/home-page";

// ?types= is read on load; a prerendered shell left the client router unable to
// replace a query the page was opened with.
export const dynamic = "force-dynamic";

export default function Page() {
  return <HomePage domain="personal" />;
}
