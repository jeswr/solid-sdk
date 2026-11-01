// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { ThemeProvider, useTheme } from "next-themes";
import { useEffect } from "react";

function ThemeAttribute() {
  const { theme } = useTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = theme ?? "system";
  }, [theme]);
  return null;
}
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem enableColorScheme>
      <ThemeAttribute />
      {children}
    </ThemeProvider>
  );
}
