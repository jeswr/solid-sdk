// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

const MAX_TRANSACTION_BYTES = 64 * 1024;
const DELIMITER_OVERLAP = "</BANKACCTFROM>".length - 1;

/** Scan only new input plus delimiter overlap; join a bounded transaction once. */
export async function* ofxTransactions(
  chunks: AsyncIterable<string>,
  skip: () => void,
): AsyncGenerator<{ block: string; currency?: string; accountId?: string; bankId?: string }> {
  const encoder = new TextEncoder();
  let overlap = "";
  let active = false;
  let oversized = false;
  let bytes = 0;
  let parts: string[] = [];
  let currency: string | undefined;
  let accountId: string | undefined;
  let bankId: string | undefined;
  let scalar: "CURDEF" | "ACCTID" | "BANKID" | undefined;
  let scalarText = "";
  let invalidScalar = false;
  let invalidContext = false;
  let accountFrom = false;

  function append(text: string): void {
    if (scalar !== undefined) {
      const end = text.search(/[<\r\n]/);
      const value = end < 0 ? text : text.slice(0, end);
      if (scalarText.length + value.length <= 256) scalarText += value;
      else invalidScalar = true;
      if (end >= 0) {
        const parsed = invalidScalar ? "" : scalarText.trim();
        if (scalar === "CURDEF") currency = parsed;
        else if (scalar === "ACCTID") accountId = parsed;
        else bankId = parsed;
        scalar = undefined;
        scalarText = "";
        invalidContext ||= invalidScalar;
      }
    }
    if (!active || oversized || !text) return;
    // Check code-unit length first so an enormous chunk is never re-encoded.
    const size =
      text.length > MAX_TRANSACTION_BYTES - bytes
        ? MAX_TRANSACTION_BYTES + 1
        : encoder.encode(text).byteLength;
    if (bytes + size > MAX_TRANSACTION_BYTES) {
      parts = [];
      oversized = true;
      skip();
    } else {
      bytes += size;
      parts.push(text);
    }
  }

  for await (const chunk of chunks) {
    const input = overlap + chunk;
    const delimiters =
      /<STMTTRN>|<\/STMTTRN>|<CURDEF>|<ACCTID>|<BANKID>|<STMTRS>|<CCSTMTRS>|<\/?(?:BANK|CC)ACCTFROM>/gi;
    let offset = 0;
    for (let match = delimiters.exec(input); match; match = delimiters.exec(input)) {
      append(input.slice(offset, match.index));
      const delimiter = match[0].toUpperCase();
      if (delimiter === "<STMTTRN>") {
        if (active && !oversized) skip();
        active = true;
        oversized = false;
        bytes = 0;
        parts = [];
      }
      append(match[0]);
      if (delimiter === "</STMTTRN>") {
        if (active && !oversized)
          yield {
            block: parts.join(""),
            currency: invalidContext ? "" : currency,
            ...(accountId === undefined ? {} : { accountId }),
            ...(bankId === undefined ? {} : { bankId }),
          };
        active = false;
        parts = [];
      } else if (delimiter === "<STMTRS>" || delimiter === "<CCSTMTRS>") {
        currency = undefined;
        accountId = undefined;
        bankId = undefined;
        invalidContext = false;
        accountFrom = false;
      } else if (delimiter === "<BANKACCTFROM>" || delimiter === "<CCACCTFROM>") {
        if (!active) accountFrom = true;
      } else if (delimiter === "</BANKACCTFROM>" || delimiter === "</CCACCTFROM>") {
        if (!active) accountFrom = false;
      } else if (
        !active &&
        (delimiter === "<CURDEF>" ||
          (accountFrom && (delimiter === "<ACCTID>" || delimiter === "<BANKID>")))
      ) {
        scalar = delimiter.slice(1, -1) as "CURDEF" | "ACCTID" | "BANKID";
        scalarText = "";
        invalidScalar = false;
      }
      offset = delimiters.lastIndex;
    }
    let split = Math.max(offset, input.length - DELIMITER_OVERLAP);
    // Do not split a UTF-16 pair: byte accounting must match the UTF-8 input.
    const preceding = input.charCodeAt(split - 1);
    if (preceding >= 0xd800 && preceding <= 0xdbff) split--;
    append(input.slice(offset, split));
    overlap = input.slice(split);
  }
  append(overlap);
  if (active && !oversized) skip();
}
