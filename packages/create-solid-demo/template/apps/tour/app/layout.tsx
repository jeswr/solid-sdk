import "./globals.css";
import { ShowcaseLayout } from "@jeswr/solid-showcase";
import { showcaseMetadata } from "@jeswr/solid-showcase/next";
import type { ReactNode } from "react";
import { walkthrough } from "../lib/walkthrough";

// Concept-demo metadata: non-affiliation description + noindex/nofollow. Keep it.
export const metadata = showcaseMetadata(walkthrough);

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ShowcaseLayout document={walkthrough}>{children}</ShowcaseLayout>
      </body>
    </html>
  );
}
