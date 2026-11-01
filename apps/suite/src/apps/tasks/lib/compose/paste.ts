// AUTHORED-BY Codex GPT-6.1-Sol
export interface PastedTask {
  title: string;
  children: string[];
}

/** Deeper indentation flattens to one child level; a leading child becomes a parent. */
export function splitPaste(text: string): PastedTask[] {
  const tasks: PastedTask[] = [];
  for (const line of text.split(/\r\n|\n|\r/)) {
    const title = line.trim();
    if (!title) continue;
    const parent = tasks.at(-1);
    if (parent && /^(?: {2}|\t)/.test(line)) parent.children.push(title);
    else tasks.push({ title, children: [] });
  }
  return tasks;
}

/** Count all resources to create, including children, before calling this guard. */
export function needsConfirm(n: number): boolean {
  return n > 5;
}
