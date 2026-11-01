// AUTHORED-BY Codex
"use client";
import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";

/** Reserve the transformed page's exact size, including when its content grows. */
export function PageCanvas({
  zoom,
  title,
  children,
}: {
  zoom: number;
  title: string;
  children?: ReactNode;
}) {
  const page = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(1056);
  const scale = Math.min(200, Math.max(50, zoom)) / 100;
  useLayoutEffect(() => {
    // Measuring is an enhancement: without ResizeObserver the page keeps its
    // default Letter-height reservation instead of failing the whole editor.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height + 194);
    });
    // The layout effect runs after the article ref is attached.
    observer.observe(page.current as HTMLElement);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="docs-page-wrap" data-zoom={zoom}>
      <div
        className="docs-page-scale"
        style={{ "--docs-zoom": scale, "--docs-page-height": `${height}px` } as CSSProperties}
      >
        <article ref={page} className="docs-page" aria-label="Document page">
          <h1 className="sr-only">{title || "Untitled document"}</h1>
          {children}
        </article>
      </div>
    </div>
  );
}
