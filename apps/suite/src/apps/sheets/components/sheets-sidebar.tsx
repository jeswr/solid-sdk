// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, toast } from "@jeswr/suite-ui";
import { Plus, Table2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { workbookHref } from "../lib/routes";
import { LIMITS, XlsxImportError } from "../lib/xlsx/common";
import { useWorkbookService } from "../state/service";

export { workbookHref } from "../lib/routes";

export function SheetsSidebar() {
  const service = useWorkbookService();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="sht-sidebar">
      {/* A Button, not Button asChild + Link: the global link colour would override the label. */}
      <Button onClick={() => router.push("/sheets/new")}>
        <Plus aria-hidden="true" size={18} />
        New spreadsheet
      </Button>
      <Button variant="outline" onClick={() => input.current?.click()}>
        <Upload aria-hidden="true" size={18} />
        Import file
      </Button>
      <input
        className="sr-only"
        tabIndex={-1}
        ref={input}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aria-label="Import file"
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          const excel =
            /\.xlsx$/i.test(file.name) ||
            file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
          try {
            if (/\.xlsm$/i.test(file.name))
              throw new Error("Macro-enabled Excel files are not supported");
            if (excel && file.size > LIMITS.compressedBytes)
              throw new XlsxImportError("Excel files must be 50 MiB or smaller");
            const opened = excel
              ? await service.createFromXlsx({
                  title: file.name.replace(/\.xlsx$/i, ""),
                  data: new Uint8Array(await file.arrayBuffer()),
                })
              : await service.createFromCsv({
                  title: file.name.replace(/\.csv$/i, ""),
                  csv: await file.text(),
                });
            router.push(workbookHref(opened.container));
          } catch (error) {
            // An Excel file's own problem (too large, macros, 1904 dates) says what's wrong.
            toast.error(
              error instanceof XlsxImportError
                ? error.message
                : excel || /\.xlsm$/i.test(file.name)
                  ? "Couldn't import this Excel file"
                  : "Couldn't import this CSV",
            );
          }
        }}
      />
      <nav aria-label="Sheets">
        <Link className="sht-nav" href="/sheets" aria-current="page">
          <Table2 aria-hidden="true" size={18} />
          All spreadsheets
        </Link>
      </nav>
    </div>
  );
}
