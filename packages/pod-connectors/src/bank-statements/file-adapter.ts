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
import { amountKey } from "./values.js";
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
      const stores = new Map<string, Store>();
      let skipped = 0;
      let records = 0;
      let shared = false;
      const skip = () => {
        skipped++;
      };
      try {
        for await (const txn of streamBankTransactions(file, config, ctx, skip, () => {
          shared = true;
        })) {
          ctx.signal?.throwIfAborted();
          // The scanner counts malformed/pending rows too; this also bounds OFX records.
          if (++records > Math.min(ctx.maxRows, MAX_ROWS))
            throw new Error("Bank statement row cap exceeded; split the export");
          const accountSlug = txn.accountKey ? await digest(txn.accountKey) : undefined;
          const slug = txn.bank ? `finance/bank/${txn.bank}-${accountSlug}.ttl` : SLUG;
          const doc = ctx.resolve(slug);
          let store = stores.get(slug);
          if (!store) {
            store = new Store();
            stores.set(slug, store);
          }
          const key = `${records - 1}|${txn.date?.toISOString() ?? ""}|${txn.amount}|${txn.description}`;
          const identity = txn.bank
            ? await digest(transactionKey(txn))
            : recordFragment(txn.description || "transaction", key);
          const inv = new BankInvoice(`${doc}#txn-${identity}`, store, DataFactory).mark();
          inv.name = txn.description || "Transaction";
          inv.totalPaymentDue = txn.amount;
          if (txn.currency) inv.priceCurrency = txn.currency;
          if (txn.bank) inv.postingTime = txn.postingTime;
          else if (txn.date) inv.dateCreated = txn.date;
          inv.identifier = txn.sourceId;
          inv.fee =
            txn.fee !== undefined && amountKey(txn.fee) !== "0"
              ? `${txn.fee} ${txn.currency}`
              : undefined;
          if (txn.accountKey) {
            const account = new BankAccount(
              `${doc}#account-${accountSlug}`,
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
      // Generic CSV and OFX retain the original shared replacement snapshot,
      // including an empty snapshot. New bank formats never access that document.
      if (shared && !stores.has(SLUG)) stores.set(SLUG, new Store());
      for (const [slug, dataset] of stores) {
        ctx.signal?.throwIfAborted();
        ctx.progress({ label: "Saving to your pod…", done: 1, total: 1 });
        await ctx.write({
          slug,
          category: "finance",
          forClass: CLASSES.Invoice,
          dataset,
          writeMode: slug === SLUG ? "replace" : "merge",
        });
      }
      // Return skipped even for pending-only statements (no fabricated empty snapshot).
      return { skipped };
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
    onGeneric();
    let rows = 0;
    for await (const { block, currency } of ofxTransactions(chunks(), skip)) {
      ctx.signal?.throwIfAborted();
      for (const txn of parseOfx(block)) {
        if (rows++ >= ctx.maxRows) return;
        yield { ...txn, currency };
      }
    }
  } finally {
    await source.return(undefined);
  }
}

/** Parse the OFX/QFX `<STMTTRN>` blocks. */
export function parseOfx(text: string, limit = Number.POSITIVE_INFINITY): Transaction[] {
  const out: Transaction[] = [];
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  const currency = tag(text, "CURDEF");
  for (const block of blocks) {
    if (out.length >= limit) break;
    const amount = tag(block, "TRNAMT");
    if (!amount) continue;
    const name = tag(block, "NAME") ?? tag(block, "MEMO") ?? "Transaction";
    out.push({
      date: parseOfxDate(tag(block, "DTPOSTED")),
      description: name,
      amount: amount.trim(),
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
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Parse ISO, `D/M/Y` or `M/D/Y` dates leniently. */
export function parseFlexibleDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const parts = trimmed.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (parts) {
    let year = Number(parts[3]);
    if (year < 100) year += 2000;
    // Default D/M (most non-US banks); swap when only the second can be a month.
    let day = Number(parts[1]);
    let month = Number(parts[2]);
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    const d = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}
