// AUTHORED-BY Codex GPT-6.1-Sol
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { RoutedErrorBoundary } from "@/components/RoutedErrorBoundary";
import { NO_FLASH_THEME_SCRIPT } from "@/lib/theme-script";
import { Providers } from "./providers";

const geistSans = localFont({
  src: "./fonts/geist/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  style: "normal",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/geist-mono/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  style: "normal",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Solid app",
  description: "A Solid app — login, profile read, pod data.",
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
      <head>
        {/* No-flash theme: set the `.dark` class BEFORE first paint from the
            persisted preference / OS setting, so a dark-mode reload never flashes
            light. The script body is a trusted, static string (no user input).
            Kept in lib/theme-script.ts so this SERVER component does not import
            from the @jeswr/app-shell barrel (which evaluates client-only
            React.createContext and breaks RSC page-data collection). It uses the
            SAME storageKey + attributeClass as the <ThemeProvider>. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>
          <AppHeader />
          <RoutedErrorBoundary>{children}</RoutedErrorBoundary>
        </Providers>
      </body>
    </html>
  );
}
