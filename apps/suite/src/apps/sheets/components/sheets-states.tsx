// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, EmptyState, ErrorState } from "@jeswr/suite-ui";
import { Table2 } from "lucide-react";
import Link from "next/link";

export function SheetsEmpty({ query, onClear }: { query: string; onClear: () => void }) {
  return query ? (
    <EmptyState variant="filtered-empty" query={query} onClearFilters={onClear} />
  ) : (
    <EmptyState
      title="No spreadsheets yet"
      body="Start with a blank spreadsheet, then add your data or import a CSV."
      icon={<Table2 size={24} aria-hidden="true" />}
      primaryAction={
        <Button asChild>
          <Link href="/sheets/new">New spreadsheet</Link>
        </Button>
      }
    />
  );
}

export function SheetsLoadError({
  onRetry,
  offline,
  message,
}: {
  onRetry: () => void;
  offline: boolean;
  message: string;
}) {
  return (
    <ErrorState error={offline ? "offline" : "unreachable"} actions={{ retry: onRetry }}>
      <p>{message}</p>
      <Link href="/sheets">Back to spreadsheets</Link>
    </ErrorState>
  );
}

export function SheetNotFound() {
  return (
    <ErrorState error="not-found">
      <p>This spreadsheet may have been moved or deleted. Check the link or open another one.</p>
      <Button asChild>
        <Link href="/sheets">Back to spreadsheets</Link>
      </Button>
    </ErrorState>
  );
}

export function SheetsAccessNotice({ offline, readOnly }: { offline: boolean; readOnly: boolean }) {
  if (!offline && !readOnly) return null;
  return (
    <div className="sht-access-notice" role="status">
      {offline && <p>You're offline. Reconnect to load or share spreadsheets.</p>}
      {readOnly && <p>View only. Download a copy or ask the owner for Write access to edit.</p>}
    </div>
  );
}
