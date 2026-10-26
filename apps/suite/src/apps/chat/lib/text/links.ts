// AUTHORED-BY Codex GPT-6.1-Sol
/** Validate a complete HTTP(S) URL and display its hostname as ASCII punycode. */
export function parseAutolink(value: string): { href: string; label: string } | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject controls before URL normalisation can silently remove them.
  if (!/^https?:\/\//i.test(value) || /[\s\\<>"'\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    return { href: url.href, label: url.href };
  } catch {
    return null;
  }
}

/** Remove sentence punctuation and unmatched closing brackets, retaining balanced URL paths. */
export function trimLinkEnd(value: string): string {
  const balance: Record<string, number> = { ")": 0, "]": 0, "}": 0 };
  const closing: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  for (const character of value) {
    if (Object.hasOwn(closing, character)) {
      const close = closing[character] as string;
      balance[close] = (balance[close] as number) - 1;
    } else if (Object.hasOwn(balance, character)) {
      balance[character] = (balance[character] as number) + 1;
    }
  }
  let end = value.length;
  while (end > 0) {
    const character = value.charAt(end - 1);
    if (/[.,!?;:]/.test(character)) end -= 1;
    else if (Object.hasOwn(balance, character) && (balance[character] as number) > 0) {
      balance[character] = (balance[character] as number) - 1;
      end -= 1;
    } else break;
  }
  return value.slice(0, end);
}
