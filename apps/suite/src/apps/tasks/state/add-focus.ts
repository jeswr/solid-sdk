// AUTHORED-BY Codex GPT-6
/** A DOM event seam shared by q, the sidebar, empty states and section menus. */
export function focusAddTask(sectionId?: string): boolean {
  const rows = [...document.querySelectorAll<HTMLElement>("main [data-tsk-add]")];
  const target = rows.find((row) => sectionId === undefined || row.dataset.tskAdd === sectionId);
  if (!target) return false;
  target.dispatchEvent(new Event("tasks:add"));
  return true;
}
export function isEditing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='dialog'], [role='alertdialog'], [role='menu']",
      ),
    )
  );
}
