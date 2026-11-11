// AUTHORED-BY Codex (GPT-6.1 Sol)
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/** No remote images or active HTML in private writing previews. Photos use authenticated reads. */
export function Markdown({ text }: { text: string }) {
  const html = sanitizeHtml(marked.parse(text, { async: false }), {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "del",
      "blockquote",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "pre",
      "code",
      "hr",
    ],
    allowedAttributes: {},
  });
  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised to inert formatting tags with no attributes
  // biome-ignore lint/style/useNamingConvention: React requires this property name
  return <div className="jn-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}
