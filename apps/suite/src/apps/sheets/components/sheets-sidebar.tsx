// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, toast } from "@jeswr/suite-ui";
import { Plus, Table2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { encodeRef } from "@/lib/refs";
import { useWorkbookService } from "../state/service";

export const workbookHref = (container: string) => `/sheets/s/${encodeRef(container)}`;

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
        Import CSV
      </Button>
      <input
        className="sr-only"
        tabIndex={-1}
        ref={input}
        type="file"
        accept=".csv,text/csv"
        aria-label="Import CSV file"
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          try {
            const opened = await service.createFromCsv({
              title: file.name.replace(/\.csv$/i, ""),
              csv: await file.text(),
            });
            router.push(workbookHref(opened.container));
          } catch {
            toast.error("Couldn't import this CSV");
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
