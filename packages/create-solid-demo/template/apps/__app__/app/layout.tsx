import "./globals.css";
import { createDisclaimerPack } from "@jeswr/solid-showcase-kit";
import type { ReactNode } from "react";
import { AppProviders } from "../components/providers";
import { app, walkthrough } from "../lib/walkthrough";

// Concept-demo metadata (noindex + non-affiliation description). Keep it.
export const metadata = createDisclaimerPack(walkthrough.branding).demoMetadata({
  appName: app.appName,
  organization: app.modelledOn,
  variant: "modelled",
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
