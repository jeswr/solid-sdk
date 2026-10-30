// AUTHORED-BY Codex GPT-6.1-Sol
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { SessionProvider } from "@/components/session-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

// Inter: a workhorse UI sans with strong tabular figures — ideal for the
// data-dense "My data" lists and dashboard counts (web-typography skill).
const inter = localFont({
  src: "../../../../packages/suite-ui/src/font-assets/inter/Inter-Variable.woff2",
  variable: "--font-sans",
  weight: "100 900",
  style: "normal",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Pod Manager — your data, your rules",
    template: "%s · Pod Manager",
  },
  description:
    "View and organise the data in your personal pod, and control which apps can see what. Calm, private, and yours.",
  applicationName: "Pod Manager",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7fbfc" },
    { media: "(prefers-color-scheme: dark)", color: "#13181c" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={200}>
            <SessionProvider>
              <AppShell>{children}</AppShell>
            </SessionProvider>
          </TooltipProvider>
          <Toaster richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
