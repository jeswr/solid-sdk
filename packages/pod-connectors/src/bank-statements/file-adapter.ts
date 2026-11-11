// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Bank CSV exports and OFX/QFX share the existing Finance Invoice layout. */
import { DataFactory, Store } from "n3";
import {
  type FileImportAdapter,
  type FileImportContext,
  type ImportFile,
  MAX_FILE_BYTES,
  MAX_ROWS,
} from "../core/file-import.js";
import { csvRecords, fileText } from "../core/file-stream.js";
import { copyDataset, mergeItems } from "../core/incremental.js";
import { recordFragment } from "../core/slug.js";
import type { IntegrationMetadata } from "../core/types.js";
import { CLASSES } from "../core/vocab.js";
import {
  BankCsvParser,
  type BankStatementOptions,
  type Transaction,
  transactionKey,
  UnrecognisedBankCsvError,
  validateBankOptions,
} from "./csv.js";
import { ofxTransactions } from "./ofx-stream.js";
import { amountKey, bankDate, currencyCode, normaliseAmount } from "./values.js";
import { BankAccount, BankInvoice } from "./vocab.js";
import { vocabMap } from "./vocab-map.js";

export {
  type BankCsvFormat,
  type BankStatementOptions,
  parseBankCsv,
  type Transaction,
} from "./csv.js";
export { normaliseAmount } from "./values.js";

const ID = "bank-statements";
const SLUG = "finance/bank-transactions.ttl";
const metadata: IntegrationMetadata = {
  id: ID,
  name: "Bank statements",
  tier: "C",
  authKind: "export-file",
  scopes: [],
  categories: ["finance"],
  whatYouGet: "Revolut, HSBC UK, Monzo and Starling CSV or OFX/QFX transactions in Finance.",
  requirements: [],
};

/** HSBC exports contain no bank/account identity; hosts must select it explicitly. */
export function createBankStatementsFileAdapter(
  options: BankStatementOptions = {},
): FileImportAdapter {
  validateBankOptions(options);
  const config = { ...options };
  return {
    vocabMap,
    metadata,
    accept: ".csv,.ofx,.qfx,text/csv,application/x-ofx",
    fileHint:
      "Revolut: account → More → Statement → CSV. HSBC UK: online banking → account → transactions → Download → CSV (requires explicit HSBC UK selection and an account label). Monzo: account → statement/export → CSV. Starling: account menu → Statements → custom dates → CSV. OFX/QFX exports are also accepted. Export one account at a time; bank CSV formats are identified by their contents.",
    async importFile(file: ImportFile, ctx: FileImportContext) {
      ctx.signal?.throwIfAborted();
      if (!Number.isSafeInteger(ctx.maxRows) || ctx.maxRows < 0)
        throw new RangeError("Bank row limit must be a nonnegative safe integer");
      if (file.size > MAX_FILE_BYTES) throw new Error("Export exceeds the 64 MiB import limit");
      ctx.progress({ label: "Reading your statement…", done: 0, total: 1 });
      const doc = ctx.resolve(SLUG);
      const store = new Store();
      let skipped = 0;
      let records = 0;
      let generic = false;
      const skip = () => {
        skipped++;
      };
      try {
        for await (const txn of streamBankTransactions(file, config, ctx, skip, () => {
          generic = true;
        })) {
          ctx.signal?.throwIfAborted();
          // The scanner counts malformed/pending rows too; this also bounds OFX records.
          if (++records > Math.min(ctx.maxRows, MAX_ROWS))
            throw new Error("Bank statement row cap exceeded; split the export");
          const key = `${records - 1}|${txn.date?.toISOString() ?? ""}|${txn.amount}|${txn.description}`;
          const identity = generic
            ? recordFragment(txn.description || "transaction", key)
            : await digest(transactionKey(txn));
          const inv = new BankInvoice(`${doc}#txn-${identity}`, store, DataFactory).mark();
          inv.name = txn.description;
          inv.totalPaymentDue = txn.amount;
          inv.priceCurrency = txn.currency;
          inv.postingTime = txn.postingTime;
          if (generic) inv.dateCreated = txn.date;
          inv.identifier = txn.sourceId;
          inv.fee =
            txn.fee !== undefined && amountKey(txn.fee) !== "0"
              ? `${txn.fee} ${txn.currency}`
              : undefined;
          if (txn.accountKey) {
            const account = new BankAccount(
              `${doc}#account-${await digest(txn.accountKey)}`,
              store,
              DataFactory,
            ).mark();
            account.name = txn.accountLabel;
            inv.account = account.value;
          }
        }
      } catch (error) {
        if (error instanceof UnrecognisedBankCsvError)
          return { unsupported: [error.message], skipped };
        throw error;
      }
      let removedLegacySubjects = 0;
      if (records || generic) {
        ctx.signal?.throwIfAborted();
        ctx.progress({ label: "Saving to your pod…", done: 1, total: 1 });
        // A read retains the document's ETag. Retire legacy IDs and merge their
        // replacements in one PUT so no intermediate duplicate state is visible.
        const previous = generic ? undefined : copyDataset(await ctx.read(SLUG));
        if (previous) {
          for (const subject of previous.getSubjects(null, CLASSES.Invoice, null)) {
            if (
              subject.termType !== "NamedNode" ||
              !subject.value.startsWith(`${doc}#txn-`) ||
              !/^(?:[a-z0-9-]{1,48}-)?[0-9a-f]{8}$/.test(
                subject.value.slice(`${doc}#txn-`.length),
              ) ||
              new BankInvoice(subject, previous, DataFactory).account !== undefined
            )
              continue;
            previous.deleteMatches(subject);
            previous.deleteMatches(DataFactory.namedNode(`${subject.value}-activity`));
            removedLegacySubjects++;
          }
        }
        const dataset = removedLegacySubjects ? mergeItems(previous, store) : store;
        const carriedForward = removedLegacySubjects
          ? dataset
              .getSubjects(null, null, null)
              .filter((subject) => store.countQuads(subject, null, null, null) === 0)
              .map((subject) => subject.value)
          : undefined;
        await ctx.write({
          slug: SLUG,
          category: "finance",
          forClass: CLASSES.Invoice,
          dataset,
          writeMode: generic || removedLegacySubjects ? "replace" : "merge",
          carriedForward,
        });
      }
      // Return skipped even for pending-only statements (no fabricated empty snapshot).
      return { skipped, removedLegacySubjects: removedLegacySubjects || undefined };
    },
  };
}
export const bankStatementsFileAdapter = createBankStatementsFileAdapter();

/** Collision-resistant, filename/row-order-independent source identities. */
async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function* streamBankTransactions(
  file: ImportFile,
  options: BankStatementOptions,
  ctx: FileImportContext,
  skip: () => void,
  onGeneric: () => void,
): AsyncGenerator<Transaction> {
  const source = fileText(file);
  let prefix = "";
  try {
    while (prefix.length < 256) {
      ctx.signal?.throwIfAborted();
      const next = await source.next();
      ctx.signal?.throwIfAborted();
      if (next.done) break;
      prefix += next.value;
    }
    async function* chunks(): AsyncGenerator<string> {
      yield prefix;
      for await (const chunk of source) {
        ctx.signal?.throwIfAborted();
        yield chunk;
      }
    }
    // Contents win over extension: a renamed CSV must not enter the OFX scanner.
    if (!/^\s*(?:OFXHEADER|<OFX|<\?xml|<STMTTRN>)/i.test(prefix)) {
      const parser = new BankCsvParser(options, ctx.maxRows, skip);
      for await (const record of csvRecords(chunks(), () => parser.skippedRecord())) {
        ctx.signal?.throwIfAborted();
        const txn = parser.record(record);
        if (parser.isGeneric) onGeneric();
        if (txn) yield txn;
      }
      return;
    }
    let rows = 0;
    const count = () => {
      if (++rows > Math.min(ctx.maxRows, MAX_ROWS))
        throw new Error("Bank statement row cap exceeded; split the export");
    };
    for await (const { block, currency, accountId, bankId } of ofxTransactions(chunks(), () => {
      count();
      skip();
    })) {
      ctx.signal?.throwIfAborted();
      count();
      const txn = parseOfx(block, 1)[0];
      const code = currency === undefined ? options.currency : currencyCode(currency);
      if (
        !txn ||
        (currency !== undefined && !code) ||
        (options.currency !== undefined && code !== options.currency)
      ) {
        skip();
        continue;
      }
      yield {
        ...txn,
        bank: "ofx",
        currency: code,
        accountKey: JSON.stringify([
          "ofx",
          bankId ?? "",
          accountId ?? "",
          options.accountLabel?.trim() ?? "",
          code ?? "",
        ]),
        accountLabel: options.accountLabel?.trim() ?? `OFX ${code ?? "account"}`,
      };
    }
  } finally {
    await source.return(undefined);
  }
}

/** Parse the OFX/QFX `<STMTTRN>` blocks. */
export function parseOfx(text: string, limit = MAX_ROWS): Transaction[] {
  if (limit !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(limit) || limit < 0))
    throw new RangeError("Bank row limit must be a nonnegative safe integer");
  if (text.length > MAX_FILE_BYTES || new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES)
    throw new Error("OFX export exceeds the import limit");
  const out: Transaction[] = [];
  const currencyRaw = tag(text, "CURDEF");
  const currency = currencyRaw === undefined ? undefined : currencyCode(currencyRaw);
  if (currencyRaw !== undefined && !currency) return out;
  let start: number | undefined;
  let records = 0;
  // Scan delimiters once: repeated unmatched openings must not trigger regex backtracking.
  for (const match of text.matchAll(/<STMTTRN>|<\/STMTTRN>/gi)) {
    if (match[0].toUpperCase() === "<STMTTRN>") {
      if (++records > MAX_ROWS)
        throw new Error("Bank statement row cap exceeded; split the export");
      start = match.index;
      continue;
    }
    if (start === undefined) continue;
    if (out.length >= limit) break;
    const block = text.slice(start, match.index + match[0].length);
    start = undefined;
    if (block.length > 64 * 1024) continue;
    const amount = normaliseAmount(tag(block, "TRNAMT") ?? "");
    const date = parseOfxDate(tag(block, "DTPOSTED"));
    if (amount === undefined || !date) continue;
    const name = tag(block, "NAME") ?? tag(block, "MEMO") ?? "Transaction";
    out.push({
      date,
      postingTime: date.toISOString(),
      description: name,
      sourceId: tag(block, "FITID"),
      amount,
      currency,
    });
  }
  return out;
}

/** Read an OFX tag value (`<TAG>value` up to the next `<` or newline). */
function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"));
  return m ? (m[1] ?? "").trim() || undefined : undefined;
}

/** OFX dates are `YYYYMMDD` (optionally followed by HHMMSS / tz). */
export function parseOfxDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return undefined;
  const date = bankDate(`${m[1]}-${m[2]}-${m[3]}`);
  return date === undefined ? undefined : new Date(date);
}

/** Compatibility helper: strict ISO or UK day/month/year; never guess US dates. */
export function parseFlexibleDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const date = bankDate(raw) ?? bankDate(raw, true);
  return date === undefined ? undefined : new Date(date);
}
