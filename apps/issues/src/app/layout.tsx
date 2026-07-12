// AUTHORED-BY Claude Opus 4.8
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SolidSessionProvider } from "@/lib/session-context";
import { ThemeProvider } from "@/components/theme-provider";
import { AppShell } from "@/components/app-shell";
import { RoutedErrorBoundary } from "@/components/routed-error-boundary";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Solid Issues",
  description: "A Solid issue tracker — your issues, in your own Pod.",
};

export const viewport: Viewport = {
  // Follows the system theme; the in-app toggle still restyles the page itself.
  // Values match the sidebar bg (light) and dark background token.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f9fa" },
    { media: "(prefers-color-scheme: dark)", color: "#17181f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        {/* Skip-to-content: targets #main inside AppShell. */}
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <SolidSessionProvider>
            <AppShell>
              <RoutedErrorBoundary>{children}</RoutedErrorBoundary>
            </AppShell>
          </SolidSessionProvider>
          <Toaster richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
