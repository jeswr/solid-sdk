// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Kbd,
  Label,
} from "@jeswr/suite-ui";
import { useId, useRef, useState } from "react";
import { type RegisteredShortcut, useRegisteredShortcuts, useShortcutSettings } from "./provider";

const frameShortcuts: RegisteredShortcut[] = [
  { id: "frame.sidebar", keys: "[", label: "Toggle sidebar", group: "Global" },
  { id: "frame.details", keys: "]", label: "Toggle details pane", group: "Global" },
];
export function ShortcutsTable() {
  const shortcuts = useRegisteredShortcuts();
  const [query, setQuery] = useState("");
  const id = useId();
  const rows = [
    ...shortcuts,
    ...frameShortcuts.filter((row) => !shortcuts.some((shortcut) => shortcut.keys === row.keys)),
  ].filter((row) =>
    `${row.label} ${row.keys} ${row.group}`.toLowerCase().includes(query.toLowerCase()),
  );
  const groups = [...new Set(rows.map((row) => row.group))];
  return (
    <div className="grid gap-4">
      <Label htmlFor={id}>Find a shortcut</Label>
      <Input id={id} value={query} onChange={(event) => setQuery(event.target.value)} />
      {groups.map((group) => (
        <table key={group} className="w-full text-left text-sm">
          <caption className="py-2 text-left font-semibold">{group}</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Action</th>
              <th scope="col">Keys</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((row) => row.group === group)
              .map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="py-2 font-normal">
                    {row.label}
                  </th>
                  <td className="py-2 text-right">
                    <Kbd>{row.keys}</Kbd>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      ))}
      {!rows.length && <p role="status">No matching shortcuts</p>}
    </div>
  );
}
/** WCAG 2.1.4 character key shortcuts: a persistent way to turn them off. */
export function CharacterKeysToggle() {
  const { characterKeys, setCharacterKeys } = useShortcutSettings();
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={characterKeys}
        onChange={(event) => setCharacterKeys(event.target.checked)}
      />
      Use single-key shortcuts (such as / and g then d)
    </label>
  );
}
export function ShortcutHelpSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85dvh] overflow-auto"
        onOpenAutoFocus={() => {
          returnFocus.current = document.activeElement as HTMLElement;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>
          Shortcuts pause while you type. Command shortcuts work everywhere.
        </DialogDescription>
        <CharacterKeysToggle />
        <ShortcutsTable />
      </DialogContent>
    </Dialog>
  );
}
