// AUTHORED-BY Codex (GPT-6.1 Sol)
import Markdown from "react-markdown";

export interface SafeMarkdownProps {
  children: string;
  className?: string;
}

/** Inert HTML, no remote images, and headings below the page heading. */
export function SafeMarkdown({ children, className }: SafeMarkdownProps) {
  return (
    <div className={className}>
      <Markdown
        skipHtml
        components={{
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
          img: ({ alt }) => <span>{alt || "Image"}</span>,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
