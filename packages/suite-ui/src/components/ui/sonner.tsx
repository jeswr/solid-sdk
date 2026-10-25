// AUTHORED-BY Codex GPT-6.1-Sol
// Adapted from shadcn/ui (MIT), new-york-v4 registry. See THIRD_PARTY_NOTICES.md.
"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

export { toast } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      duration={5000}
      theme={theme as NonNullable<ToasterProps["theme"]>}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon aria-hidden="true" strokeWidth={1.75} className="size-4" />,
        info: <InfoIcon aria-hidden="true" strokeWidth={1.75} className="size-4" />,
        warning: <TriangleAlertIcon aria-hidden="true" strokeWidth={1.75} className="size-4" />,
        error: <OctagonXIcon aria-hidden="true" strokeWidth={1.75} className="size-4" />,
        loading: (
          <Loader2Icon aria-hidden="true" strokeWidth={1.75} className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
