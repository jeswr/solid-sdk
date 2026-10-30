// AUTHORED-BY Codex GPT-6.1-Sol
/** Extract whitespace-delimited labels outside code, links and escaped text. */
export function splitContent(content: string): { title: string; labels: string[] } {
  const labels: string[] = [];
  const title: string[] = [];
  const label = /@[\p{L}\p{N}_-]+/uy;
  let cursor = 0;
  let code = 0;
  let fence = "";
  let fenceDepth = 0;
  // Zero denotes a block quote; positive widths denote list-item indentation.
  const containers: number[] = [];
  const quoteDepths: number[] = [];
  let brackets = 0;
  let parentheses = 0;
  let linkQuote = "";
  let angle = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (
      (i === 0 || content[i - 1] === "\n" || (content[i - 1] === "\r" && char !== "\n")) &&
      !code &&
      !linkQuote
    ) {
      let end = i;
      while (end < content.length && content[end] !== "\n" && content[end] !== "\r") end++;
      let expanded = 0;
      // Expand tabs only in the detection copy; preserve the original Markdown.
      let sourceLine = content.slice(i, end).replace(/\t/g, (_tab, index: number) => {
        const width = 4 - ((index + expanded) % 4);
        expanded += width - 1;
        return " ".repeat(width);
      });
      if (content[end] === "\r" && content[end + 1] === "\n") end++;
      let offset = 0;
      let depth = 0;
      let quotes = 0;
      let textEnd = sourceLine.length;
      while (sourceLine[textEnd - 1] === " ") textEnd--;
      // Match existing containers before looking for any new ones.
      for (const indentation of containers) {
        if (offset >= textEnd) {
          // A blank suffix continues every list up to the next unmatched quote.
          // Jump there so repeated blank lines never rescan retained list depths.
          depth = quoteDepths[quotes] ?? containers.length;
          offset = sourceLine.length;
          break;
        }
        if (indentation === 0) {
          const quote = /^ {0,3}> ?/.exec(sourceLine.slice(offset));
          if (!quote) break;
          offset += quote[0].length;
          quotes++;
        } else {
          let spaces = 0;
          while (spaces < indentation && sourceLine[offset + spaces] === " ") spaces++;
          if (spaces < indentation) break;
          offset += spaces;
        }
        depth++;
      }
      if (depth < fenceDepth) fence = "";
      containers.length = depth;
      quoteDepths.length = quotes;
      // Locate a possible thematic-break suffix once, avoiding a scan per list depth.
      let thematicStart = textEnd;
      let thematicMarkers = 0;
      const thematicMarker = sourceLine[textEnd - 1];
      if (thematicMarker === "-" || thematicMarker === "*") {
        while (thematicStart > 0) {
          const char = sourceLine[thematicStart - 1];
          if (char === thematicMarker) thematicMarkers++;
          else if (char !== " ") break;
          thematicStart--;
        }
      }
      // Markers inside a fence are literal, so strip only its enclosing containers.
      while (!fence) {
        const quote = /^ {0,3}> ?/.exec(sourceLine.slice(offset));
        if (quote) {
          quoteDepths.push(containers.length);
          containers.push(0);
          offset += quote[0].length;
          continue;
        }
        const item = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?= |$)/.exec(sourceLine.slice(offset));
        // Thematic breaks take precedence over list markers; underscores cannot start items.
        if (!item || (offset >= thematicStart && thematicMarkers >= 3)) break;
        let padding = 0;
        while (sourceLine[offset + item[0].length + padding] === " ") padding++;
        // Empty items and items starting with indented code use one separator column.
        if (padding > 4 || offset + item[0].length + padding === sourceLine.length) padding = 1;
        const width = item[0].length + padding;
        containers.push(width);
        offset += width;
      }
      sourceLine = sourceLine.slice(offset);
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
        fenceDepth = containers.length;
        i = end;
        continue;
      }
      if (/^ {4}/.test(sourceLine)) {
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
