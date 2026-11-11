// AUTHORED-BY Codex GPT-6.1-Sol
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Web server routes never enter the static native build graph. */
export function includeNativeSource(path, root) {
  return !["dev", ".well-known", "api"].some((name) => path === join(root, "src/app", name));
}

/** Native client references must enter the build graph only during staging. */
export async function stageCalendarRoutes(sourceRoot) {
  const calendar = join(sourceRoot, "app/(suite)/calendar");
  await writeFile(
    join(calendar, "page.tsx"),
    `// AUTHORED-BY Codex GPT-6.1-Sol
import { Suspense } from "react";
import { NativeCalendarIndex } from "@/apps/calendar/components/native-route";
export default function Page() {
  return <Suspense><NativeCalendarIndex /></Suspense>;
}
`,
  );
  await writeFile(
    join(calendar, "[view]/page.tsx"),
    `// AUTHORED-BY Codex GPT-6.1-Sol
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { Suspense } from "react";
import { NativeCalendarView } from "@/apps/calendar/components/native-route";
export const dynamicParams = false;
export function generateStaticParams() { return [{ view: "__" }]; }
export default function Page() {
  return <Suspense fallback={<LoadingSkeleton preset="grid" />}><NativeCalendarView /></Suspense>;
}
`,
  );
}
