// AUTHORED-BY Codex (GPT-6.1 Sol)
import Markdown from "react-markdown";

export interface SafeMarkdownProps {
  children: string;
  className?: string;
  /** Open links in a new tab when navigating away would lose unsaved work. */
  linkTarget?: "_blank" | "_self";
}

/** Inert HTML, no remote images, and headings below the page heading. */
export function SafeMarkdown({ children, className, linkTarget }: SafeMarkdownProps) {
  return (
    <div className={className}>
      <Markdown
        skipHtml
        components={{
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
          img: ({ alt }) => <span>{alt || "Image"}</span>,
          a: ({ children, href, title }) => (
            <a
              href={href}
              title={title}
              target={linkTarget}
              rel={linkTarget === "_blank" ? "noopener noreferrer" : undefined}
            >
              {children}
            </a>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
