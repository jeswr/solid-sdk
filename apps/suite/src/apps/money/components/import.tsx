// AUTHORED-BY Codex GPT-6
"use client";
import { Button, DropZoneOverlay, LoadingSkeleton } from "@jeswr/suite-ui";
import { Check, FileUp } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import {
  commitImport,
  detectFormat,
  type PreviewRow,
  previewImport,
  recoveryPreview,
  suggestMapping,
} from "../lib/data/import";
import type { CsvOptions, DateFormat } from "../lib/import";
import { useMoney } from "../state/money-context";
import { AccountDialog, Amount, CategorySelect, MoneySelect } from "./money-forms";

type Step = "choose" | "map" | "preview" | "import" | "done";
const steps = ["Choose file", "Map columns", "Preview", "Import", "Done"];
export function ImportScreen() {
  const money = useMoney();
  const params = useSearchParams();
  const [accountId, setAccountId] = useState(params.get("account") ?? money.accounts[0]?.id ?? "");
  const account = money.accounts.find((a) => a.id === accountId);
  const [step, setStep] = useState<Step>("choose");
  const [add, setAdd] = useState(false);
  const [file, setFile] = useState<{ name: string; text: string; format: "csv" | "ofx" }>();
  const [balanceColumn, setBalanceColumn] = useState("none");
  const [mapping, setMapping] = useState<ReturnType<typeof suggestMapping>>();
  const [options, setOptions] = useState<CsvOptions>({
    columns: { date: 0, description: 1, amount: 2 },
  });
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [count, setCount] = useState(0);
  const [recover, setRecover] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const reviewed = useRef<number | null>(null);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const invalidate = () => {
    generation.current++;
    reviewed.current = null;
    setRows([]);
    setRecover(false);
    setError("");
    setBusy(false);
  };
  const chooseAccount = (id: string) => {
    invalidate();
    setAccountId(id);
  };
  const changeOptions = (next: CsvOptions) => {
    invalidate();
    setOptions(next);
  };
  const back = (next: Step) => {
    invalidate();
    setStep(next);
  };
  const readFile = async (chosen?: File) => {
    if (!chosen) return;
    invalidate();
    const request = generation.current;
    setStep("choose");
    setFile(undefined);
    setMapping(undefined);
    setBusy(true);
    try {
      if (chosen.size > 10485760) throw new Error("Choose a statement smaller than 10 MiB.");
      const text = await chosen.text();
      if (request !== generation.current) return;
      const format = detectFormat(chosen.name, text);
      setRecover(false);
      setFile({ name: chosen.name, text, format });
      if (format === "csv") {
        const suggested = suggestMapping(text);
        setMapping(suggested);
        setOptions(suggested.options);
        setBalanceColumn(suggested.balanceColumn >= 0 ? String(suggested.balanceColumn) : "none");
      }
    } catch (failure) {
      if (request !== generation.current) return;
      setFile(undefined);
      setError(failure instanceof Error ? failure.message : "Couldn't read this statement");
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  const preview = async () => {
    if (!account || !file) return;
    invalidate();
    const request = generation.current;
    setBusy(true);
    try {
      const rules = money.categories
        .filter((c) => !money.categories.some((child) => child.parent === c.id))
        .map((c) => ({
          category: c.id,
          description: { match: "contains" as const, value: c.label },
        }));
      const saved = await recoveryPreview(
        money.session,
        account.id,
        account.currency,
        file.text,
        file.format,
      );
      if (request !== generation.current) return;
      const result =
        saved ??
        (await previewImport(
          money.session,
          account.id,
          account.currency,
          file.text,
          file.format,
          options,
          rules,
        ));
      if (request !== generation.current) return;
      setRecover(saved !== undefined);
      if (!result.length)
        throw new Error("This statement has no transactions. Choose another file.");
      setRows(result);
      reviewed.current = request;
      setStep("preview");
    } catch (failure) {
      if (request !== generation.current) return;
      setError(failure instanceof Error ? failure.message : "Couldn't parse this statement");
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  const active = ["choose", "map", "preview", "import", "done"].indexOf(step);
  const columnOptions = (optional: boolean) => [
    ...(optional ? [{ value: "none", label: "Not mapped" }] : []),
    ...(mapping?.headers ?? []).map((label, index) => ({
      value: String(index),
      label: options.hasHeader === false ? `Column ${index + 1}` : label,
    })),
  ];
  const mapColumn = (key: keyof CsvOptions["columns"], value: string) => {
    const columns = { ...options.columns };
    if (value === "none") delete columns[key];
    else columns[key] = Number(value);
    if (key === "amount" && value !== "none") {
      delete columns.debit;
      delete columns.credit;
    }
    if ((key === "debit" || key === "credit") && value !== "none") delete columns.amount;
    changeOptions({ ...options, columns });
  };
  return (
    <>
      <header className="mon-heading">
        <div>
          <p className="mon-eyebrow">Bring your history with you</p>
          <h1>Import a statement</h1>
          <p className="mon-subtitle">CSV, OFX and QFX files. Your original stays in your pod.</p>
        </div>
      </header>
      <ol className="mon-steps" aria-label="Import steps">
        {steps.map((label, index) => (
          <li key={label} aria-current={active === index ? "step" : undefined}>
            <span>{index < active ? <Check size={16} aria-hidden="true" /> : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <section className="mon-panel mon-import-panel">
        <h2>{steps[active]}</h2>
        {error && (
          <div role="alert" className="mon-inline-error">
            <p>{error}</p>
            <Button
              variant="outline"
              onClick={() => {
                setError("");
                if (step === "map" || step === "preview") void preview();
                else fileInput.current?.click();
              }}
            >
              Retry
            </Button>
          </div>
        )}
        {step === "choose" && (
          <>
            <div className="mon-filter-row">
              <MoneySelect
                label="Import into account"
                value={accountId}
                onChange={chooseAccount}
                options={money.accounts.map((a) => ({
                  value: a.id,
                  label: `${a.label} · ${a.currency}`,
                }))}
              />
              <Button variant="outline" onClick={() => setAdd(true)}>
                Create an account
              </Button>
            </div>
            <DropZoneOverlay
              folderName="Money"
              onFiles={(files) => {
                if (files.files.length !== 1) {
                  setError("Choose one statement at a time.");
                  return;
                }
                return readFile(files.files[0]?.file);
              }}
            >
              <div className="mon-drop">
                <FileUp size={36} aria-hidden="true" />
                <p>Drop a statement here</p>
                <span className="mon-hint">CSV, OFX or QFX · up to 10 MiB</span>
                <label className="mon-file-picker">
                  Choose file
                  <input
                    ref={fileInput}
                    aria-label="Statement file"
                    type="file"
                    accept=".csv,.tsv,.ofx,.qfx,.pdf,text/csv"
                    onChange={(event) => void readFile(event.target.files?.[0])}
                  />
                </label>
              </div>
            </DropZoneOverlay>
            {file && (
              <p role="status">
                {file.name} · {file.format.toUpperCase()} ready
              </p>
            )}
            {busy && <LoadingSkeleton preset="list" />}
            <div className="mon-wizard-actions">
              <Button
                disabled={!file || !account || busy}
                onClick={() => {
                  if (file?.format === "csv") setStep("map");
                  else void preview();
                }}
              >
                Continue
              </Button>
            </div>
          </>
        )}
        {step === "map" && mapping && (
          <>
            <p className="mon-hint">
              Match the columns in {file?.name}. Use either a signed amount, or debit and credit
              columns.
            </p>
            <label className="mon-checkbox-label">
              <input
                type="checkbox"
                checked={options.hasHeader !== false}
                onChange={(e) => changeOptions({ ...options, hasHeader: e.target.checked })}
              />
              First row contains column names
            </label>
            <div className="mon-mapping-grid">
              {(["date", "description", "amount", "debit", "credit", "currency"] as const).map(
                (key) => (
                  <MoneySelect
                    key={key}
                    label={
                      {
                        date: "Date column",
                        description: "Description / payee column",
                        amount: "Amount column",
                        debit: "Debit column",
                        credit: "Credit column",
                        currency: "Currency column",
                      }[key]
                    }
                    value={
                      options.columns[key] === undefined ? "none" : String(options.columns[key])
                    }
                    onChange={(value) => mapColumn(key, value)}
                    options={columnOptions(key !== "date" && key !== "description")}
                  />
                ),
              )}
              <MoneySelect
                label="Balance column (optional)"
                value={balanceColumn}
                onChange={(value) => {
                  invalidate();
                  setBalanceColumn(value);
                }}
                options={columnOptions(true)}
              />
              <MoneySelect
                label="Date format"
                value={options.dateFormat ?? "auto"}
                onChange={(value) =>
                  changeOptions({
                    ...(({ dateFormat: _dateFormat, ...rest }) => rest)(options),
                    ...(value === "auto" ? {} : { dateFormat: value as DateFormat }),
                  })
                }
                options={[
                  { value: "auto", label: "Detect automatically" },
                  { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
                  { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
                  { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
                ]}
              />
              <MoneySelect
                label="Decimal separator"
                value={options.decimalSeparator ?? "."}
                onChange={(value) =>
                  changeOptions({ ...options, decimalSeparator: value as "." | "," })
                }
                options={[
                  { value: ".", label: "Point (12.50)" },
                  { value: ",", label: "Comma (12,50)" },
                ]}
              />
            </div>
            <h3>Sample preview</h3>
            {balanceColumn !== "none" && (
              <p className="mon-hint">
                Source balances are shown for reference. The ledger calculates running balances from
                your opening balance.
              </p>
            )}
            <table className="mon-simple-table mon-map-sample">
              <caption className="sr-only">Mapped sample rows</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payee / description</th>
                  <th>Amount / debit</th>
                  <th>Credit</th>
                  {balanceColumn !== "none" && <th>Source balance</th>}
                </tr>
              </thead>
              <tbody>
                {(options.hasHeader === false ? mapping.rows : mapping.rows.slice(1))
                  .slice(0, 3)
                  .map((row, index) => (
                    <tr key={String(index)}>
                      <td>{row[Number(options.columns.date)]}</td>
                      <td>{row[Number(options.columns.description)]}</td>
                      <td>{row[Number(options.columns.amount ?? options.columns.debit)]}</td>
                      <td>
                        {options.columns.credit === undefined
                          ? "—"
                          : row[Number(options.columns.credit)]}
                      </td>
                      {balanceColumn !== "none" && <td>{row[Number(balanceColumn)]}</td>}
                    </tr>
                  ))}
              </tbody>
            </table>
            <div className="mon-wizard-actions">
              <Button variant="outline" onClick={() => back("choose")}>
                Back
              </Button>
              <Button onClick={() => void preview()} disabled={busy}>
                {busy ? "Preparing preview…" : "Preview transactions"}
              </Button>
            </div>
          </>
        )}
        {step === "preview" && (
          <>
            <p role="status">
              {rows.filter((row) => row.include).length} of {rows.length} transactions selected ·{" "}
              {rows.filter((row) => row.duplicate).length} possible duplicates
            </p>
            <p className="mon-hint">
              Possible duplicates are excluded by default. Review categories before importing into{" "}
              {account?.label}.
            </p>
            {recover && (
              <p role="status" className="mon-hint">
                Resume uses your original mapping and row selection. Rows already saved stay
                unchanged.
              </p>
            )}
            <section
              className="mon-preview-list"
              aria-label="Statement preview, scroll to review all columns and rows"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need access to the scroll region.
              tabIndex={0}
            >
              <table className="mon-simple-table">
                <caption className="sr-only">Statement preview</caption>
                <thead>
                  <tr>
                    <th>Include</th>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry, index) => (
                    <tr key={entry.index} className={entry.duplicate ? "mon-duplicate" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Include row ${index + 1}`}
                          checked={entry.include}
                          disabled={recover}
                          onChange={(e) =>
                            setRows((current) =>
                              current.map((row, i) =>
                                i === index ? { ...row, include: e.target.checked } : row,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>{entry.row.date}</td>
                      <td>
                        {entry.row.description}
                        {entry.duplicate && (
                          <span className="mon-duplicate-label">Possible duplicate</span>
                        )}
                      </td>
                      <td>
                        <CategorySelect
                          label={`Category for import row ${index + 1}`}
                          value={entry.category}
                          disabled={recover}
                          onChange={(value) =>
                            setRows((current) =>
                              current.map((row, i) =>
                                i === index ? { ...row, category: value } : row,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <Amount
                          amount={entry.row.amount}
                          currency={account?.currency ?? "GBP"}
                          signed
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <div className="mon-wizard-actions">
              <Button
                variant="outline"
                onClick={() => back(file?.format === "csv" ? "map" : "choose")}
              >
                Back
              </Button>
              <Button
                disabled={(!recover && !rows.some((row) => row.include)) || money.saving}
                onClick={async () => {
                  if (!file || !account || reviewed.current !== generation.current) return;
                  setStep("import");
                  setError("");
                  const saved = await money.mutate(async () => {
                    const result = await commitImport(
                      money.session,
                      account.id,
                      account.currency,
                      file.text,
                      file.format,
                      options,
                      rows,
                      (done, total) => setProgress({ done, total }),
                      recover,
                    );
                    setCount(result.count);
                  });
                  if (saved) setStep("done");
                  else {
                    setRecover(true);
                    setError(
                      "The import did not finish. Resume import to restore missing rows using the original mapping and selection. Transactions already saved will be kept. Completed statements cannot be imported again.",
                    );
                    setStep("preview");
                  }
                }}
              >
                {recover
                  ? "Resume import"
                  : `Import ${rows.filter((row) => row.include).length} transactions`}
              </Button>
            </div>
          </>
        )}
        {step === "import" && (
          <div className="mon-import-progress" role="status" aria-live="polite">
            <p>Saving statement and transactions…</p>
            <progress
              value={progress.done}
              max={Math.max(1, progress.total)}
              aria-label="Statement import progress"
            />
            <p>
              {progress.done} of {progress.total} months saved
            </p>
          </div>
        )}
        {step === "done" && (
          <div className="mon-import-done">
            <Check size={36} aria-hidden="true" />
            <h3>Statement imported</h3>
            <p role="status">
              {count} transactions added to {account?.label}.
            </p>
            <p className="mon-hint">Your original statement is saved with these transactions.</p>
            <div className="mon-wizard-actions">
              <Button asChild>
                <Link href={`/money/a/${encodeRef(accountId)}`}>View ledger</Link>
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  back("choose");
                  setFile(undefined);
                  setRows([]);
                }}
              >
                Import another statement
              </Button>
            </div>
          </div>
        )}
      </section>
      <AccountDialog open={add} onOpenChange={setAdd} onCreated={chooseAccount} />
    </>
  );
}
