// AUTHORED-BY Codex
"use client";
import {
  AppIcon,
  Button,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@jeswr/suite-ui";
import Link from "next/link";
import type { ReactNode } from "react";
export function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: disabled controls need a keyboard-focusable tooltip wrapper */}
          <span className="docs-hint" tabIndex={0}>
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
export function DocsSidebar({ filter = "all" }: { filter?: string }) {
  return (
    <div className="docs-sidebar">
      <h2>
        <AppIcon app="docs" size={32} decorative />
        Docs
      </h2>
      <Button asChild>
        <Link href="/docs/new">＋ New document</Link>
      </Button>
      <nav aria-label="Documents">
        <Link href="/docs" aria-current={filter === "all" ? "page" : undefined}>
          All documents
        </Link>
        <Link href="/docs?filter=recent" aria-current={filter === "recent" ? "page" : undefined}>
          Recent
        </Link>
        <Link href="/docs?filter=starred" aria-current={filter === "starred" ? "page" : undefined}>
          Starred
        </Link>
        <Hint text="Coming soon">
          <Button variant="ghost" disabled>
            Shared with me
          </Button>
        </Hint>
        <Hint text="Coming soon">
          <Button variant="ghost" disabled>
            Trash
          </Button>
        </Hint>
      </nav>
      <p className="docs-sidebar-note">
        Your words.
        <br />
        Your space.
      </p>
    </div>
  );
}
export function DocumentSkeleton() {
  return (
    <div role="status" className="docs-loading" aria-label="Loading document" aria-busy="true">
      <Skeleton className="h-8 w-2/3" />
      <div className="docs-disabled-toolbar" role="toolbar" aria-label="Formatting">
        <Button disabled>Normal text</Button>
        <Button disabled>Bold</Button>
        <Button disabled>Italic</Button>
      </div>
      {Array.from({ length: 12 }, (_, i) => (
        <Skeleton key={`line-${i.toString()}`} className="h-3 w-full" />
      ))}
    </div>
  );
}
export function DocsError({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="docs-empty" role="alert">
      <AppIcon app="docs" size={48} decorative />
      <h1>{title}</h1>
      {children}
    </div>
  );
}
