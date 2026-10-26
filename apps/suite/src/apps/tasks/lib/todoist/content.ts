// AUTHORED-BY Codex GPT-6.1-Sol
/** Extract whitespace-delimited labels outside code, links and escaped text. */
export function splitContent(content: string): { title: string; labels: string[] } {
  const labels: string[] = [];
  const title: string[] = [];
  const label = /@[\p{L}\p{N}_-]+/uy;
  let cursor = 0;
  let code = 0;
  let fence = 0;
  let brackets = 0;
  let parentheses = 0;
  let angle = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if ((i === 0 || content[i - 1] === "\n") && !code) {
      const newline = content.indexOf("\n", i);
      const end = newline < 0 ? content.length : newline;
      const sourceLine = content.slice(i, end);
      const marker = /^ {0,3}(~{3,})/.exec(sourceLine);
      if (fence) {
        if (
          marker &&
          (marker[1] as string).length >= fence &&
          sourceLine.slice(marker[0].length).trim() === ""
        )
          fence = 0;
        i = end;
        continue;
      }
      if (marker) {
        fence = (marker[1] as string).length;
        i = end;
        continue;
      }
      if (/^(?: {4}|\t)/.test(sourceLine)) {
        i = end;
        continue;
      }
    }
    if (char === "\\" && !code) {
      i++;
      continue;
    }
    if (char === "`") {
      let end = i + 1;
      while (content[end] === "`") end++;
      const width = end - i;
      if (code === width) code = 0;
      else if (code === 0) code = width;
      i = end - 1;
      continue;
    }
    if (code) continue;
    if (char === "[") brackets++;
    if (char === "]") brackets = Math.max(0, brackets - 1);
    if (char === "(" && (content[i - 1] === "]" || parentheses)) parentheses++;
    if (char === ")") parentheses = Math.max(0, parentheses - 1);
    if (char === "<") angle = true;
    if (char === ">") angle = false;
    if (
      char !== "@" ||
      brackets ||
      parentheses ||
      angle ||
      (i > 0 && !/\s/.test(content[i - 1] as string))
    )
      continue;
    label.lastIndex = i;
    const match = label.exec(content);
    if (
      !match ||
      (label.lastIndex < content.length && !/\s/.test(content[label.lastIndex] as string))
    )
      continue;
    labels.push(match[0].slice(1));
    title.push(content.slice(cursor, i));
    cursor = label.lastIndex;
    // Remove one separator with the token; preserve other whitespace and markdown.
    if (content[cursor] === " ") cursor++;
    i = cursor - 1;
  }
  title.push(content.slice(cursor));
  return { title: title.join("").trim(), labels };
}
