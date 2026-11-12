// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@jeswr/suite-ui";
import { useEffect, useState } from "react";
import type { SheetEngine } from "../lib/contract";
import { columnToIndex } from "../lib/refs/notation";

export function DataMenus({ engine, locked }: { engine: SheetEngine | null; locked: boolean }) {
  const [sorting, setSorting] = useState(false);
  const [scope, setScope] = useState<"range" | "sheet">("range");
  const [column, setColumn] = useState("A");
  const [ascending, setAscending] = useState(true);
  const [header, setHeader] = useState(true);
  const [filtered, setFiltered] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!engine) return;
    const refresh = () => setFiltered(engine.hasFilter?.() ?? false);
    refresh();
    const values = engine.onValuesChange?.(refresh);
    const selection = engine.onSelection?.(refresh);
    return () => {
      values?.();
      selection?.();
    };
  }, [engine]);
  useEffect(() => {
    if (!engine) return;
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (!["h", "f"].includes(event.key.toLowerCase())) return;
      // Find in the grid; preserve browser Find outside the spreadsheet canvas.
      if (
        event.key.toLowerCase() === "f" &&
        !(event.target instanceof Element && event.target.closest(".sht-univer"))
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void engine.findReplace?.();
    };
    document.addEventListener("keydown", shortcut, true);
    return () => document.removeEventListener("keydown", shortcut, true);
  }, [engine]);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" disabled={!engine}>
            Data
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            disabled={locked}
            onSelect={() => {
              setError(undefined);
              setSorting(true);
            }}
          >
            Sort range
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={async () => {
              await engine?.toggleFilter?.();
              setFiltered(engine?.hasFilter?.() ?? false);
            }}
          >
            {filtered ? "Remove filter" : "Create a filter"}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!filtered} onSelect={() => void engine?.clearFilter?.()}>
            Clear filter
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" disabled={!engine}>
            Edit
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => void engine?.findReplace?.()}>
            Find and replace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={sorting} onOpenChange={setSorting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sort range</DialogTitle>
            <DialogDescription>
              Sort cell contents by a column. Comments and chart ranges stay at their cell
              addresses.
            </DialogDescription>
          </DialogHeader>
          <form
            className="sht-data-options"
            onSubmit={(event) => {
              event.preventDefault();
              if (locked) return;
              try {
                const index = columnToIndex(column.toUpperCase());
                const result = engine?.sortRange?.({
                  scope,
                  column: index - 1,
                  ascending,
                  header,
                });
                if (!result) throw new Error("Sort unavailable");
                if (result.status === "blocked") setError(result.reason);
                else setSorting(false);
              } catch {
                setError("Select a range with data and enter a column within it.");
              }
            }}
          >
            <label htmlFor="sht-sort-scope">Sort</label>
            <select
              id="sht-sort-scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as "range" | "sheet")}
            >
              <option value="range">Selected range</option>
              <option value="sheet">Whole sheet</option>
            </select>
            <label htmlFor="sht-sort-column">Column</label>
            <input
              id="sht-sort-column"
              value={column}
              onChange={(event) => setColumn(event.target.value)}
              placeholder="A"
            />
            <label htmlFor="sht-sort-direction">Order</label>
            <select
              id="sht-sort-direction"
              value={ascending ? "asc" : "desc"}
              onChange={(event) => setAscending(event.target.value === "asc")}
            >
              <option value="asc">A–Z</option>
              <option value="desc">Z–A</option>
            </select>
            <label>
              <input
                type="checkbox"
                checked={header}
                onChange={(event) => setHeader(event.target.checked)}
              />
              Data has a header row
            </label>
            {error && <p role="alert">{error}</p>}
            <Button type="submit" disabled={locked}>
              Sort
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
