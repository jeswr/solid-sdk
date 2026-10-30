// AUTHORED-BY Codex GPT-6.1-Sol
/** Extract whitespace-delimited labels outside code, links and escaped text. */
export function splitContent(content: string): { title: string; labels: string[] } {
  const labels: string[] = [];
  const title: string[] = [];
  const label = /@[\p{L}\p{N}_-]+/uy;
  let cursor = 0;
  let code = 0;
  let fence = "";
  let fenceQuotes = 0;
  let brackets = 0;
  let parentheses = 0;
  let linkQuote = "";
  let angle = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if ((i === 0 || content[i - 1] === "\n" || content[i - 1] === "\r") && !code && !linkQuote) {
      let end = i;
      while (end < content.length && content[end] !== "\n" && content[end] !== "\r") end++;
      let sourceLine = content.slice(i, end);
      if (content[end] === "\r" && content[end + 1] === "\n") end++;
      let offset = 0;
      let quotes = 0;
      // Strip only the enclosing quote markers; extra markers inside code are literal.
      while (!fence || quotes < fenceQuotes) {
        let start = offset;
        while (start < offset + 3 && sourceLine[start] === " ") start++;
        if (sourceLine[start] !== ">") break;
        quotes++;
        offset = start + 1;
        if (sourceLine[offset] === " " || sourceLine[offset] === "\t") offset++;
      }
      sourceLine = sourceLine.slice(offset);
      // A fence also ends when its enclosing block quote ends.
      if (quotes < fenceQuotes) fence = "";
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(sourceLine);
      if (fence) {
        if (
          marker &&
          (marker[1] as string)[0] === fence[0] &&
          (marker[1] as string).length >= fence.length &&
          /^[ \t]*$/.test(sourceLine.slice(marker[0].length))
        )
          fence = "";
        i = end;
        continue;
      }
      // A backtick fence's info string cannot itself contain a backtick.
      if (
        marker &&
        ((marker[1] as string)[0] !== "`" || !sourceLine.slice(marker[0].length).includes("`"))
      ) {
        fence = marker[1] as string;
        fenceQuotes = quotes;
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
    if (linkQuote) {
      if (char === linkQuote) linkQuote = "";
      continue;
    }
    // Quotes start a link title only after the destination's whitespace separator.
    if (
      !code &&
      parentheses === 1 &&
      !angle &&
      (char === '"' || char === "'") &&
      /\s/.test(content[i - 1] as string)
    ) {
      linkQuote = char;
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
    // Angle-delimited destinations may contain unbalanced literal parentheses.
    if (!angle) {
      if (char === "(" && (content[i - 1] === "]" || parentheses)) parentheses++;
      if (char === ")") parentheses = Math.max(0, parentheses - 1);
    }
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
