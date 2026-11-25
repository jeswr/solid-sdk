// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/suspicious/noArrayIndexKey: syntax tokens are stateless and replaced with each parsed message

import { Fragment } from "react";
import { SuiteChip } from "@/components/chips";
import { type InlineNode, parseMessageText } from "../lib/text";

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return nodes.map((node, index) => (
    <Fragment key={index}>
      {node.type === "chip" ? (
        <SuiteChip reference={node.ref} />
      ) : node.type === "text" || node.type === "emoji" ? (
        node.value
      ) : node.type === "code" ? (
        <code>{node.value}</code>
      ) : node.type === "bold" ? (
        <strong>
          <Inline nodes={node.children} />
        </strong>
      ) : node.type === "italic" ? (
        <em>
          <Inline nodes={node.children} />
        </em>
      ) : node.type === "link" ? (
        <a href={node.href} target="_blank" rel="noopener noreferrer nofollow">
          {node.label}
        </a>
      ) : node.type === "mention" && node.webId ? (
        <a href={node.webId} target="_blank" rel="noopener noreferrer nofollow">
          {node.label}
        </a>
      ) : node.type === "mention" ? (
        node.label
      ) : null}
    </Fragment>
  ));
}
export function MessageText({ text }: { text: string }) {
  return (
    <div className="chat-message-text">
      {parseMessageText(text).map((block, index) => (
        <Fragment key={index}>
          {block.type === "paragraph" ? (
            <p>
              <Inline nodes={block.children} />
            </p>
          ) : block.type === "quote" ? (
            <blockquote>
              <Inline nodes={block.children} />
            </blockquote>
          ) : block.type === "codeBlock" ? (
            <pre>
              <code>{block.value}</code>
            </pre>
          ) : (
            block.type === "list" &&
            (block.ordered ? (
              <ol start={block.start}>
                {block.items.map((item, i) => (
                  <li key={i}>
                    <Inline nodes={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul>
                {block.items.map((item, i) => (
                  <li key={i}>
                    <Inline nodes={item} />
                  </li>
                ))}
              </ul>
            ))
          )}
        </Fragment>
      ))}
    </div>
  );
}
