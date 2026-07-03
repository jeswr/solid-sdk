// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import type { Metadata } from "next";
import "@jeswr/app-shell/styles.css";
import "./globals.css";
import { AppChrome } from "@/components/app-chrome";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Coeliac Diary",
  description:
    "A pod-owned, multi-intolerance food & symptom diary — scan, log, and own your health data in your Solid pod. Decision support, not diagnosis.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AppChrome>{children}</AppChrome>
        </Providers>
      </body>
    </html>
  );
}
