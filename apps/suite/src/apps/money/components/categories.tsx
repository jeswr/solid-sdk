// AUTHORED-BY Codex GPT-6
"use client";
import { type Category, type CategoryNode, categoryTree } from "@jeswr/solid-money";
import { Button, EditableText, EmptyState, IconButton, Input } from "@jeswr/suite-ui";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { deleteCategory, reparent, saveCategories } from "../lib/data/categories";
import { storeOf } from "../lib/data/container";
import { useMoney } from "../state/money-context";
import { Modal, MoneySelect } from "./money-forms";
export function CategoriesScreen() {
  const money = useMoney();
  const tree = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [focused, setFocused] = useState("");
  const [dialog, setDialog] = useState<{
    kind: "add" | "move" | "delete";
    id?: string | undefined;
    parent?: string | undefined;
  }>();
  const [name, setName] = useState("");
  const [parent, setParent] = useState("root");
  const [replacement, setReplacement] = useState("none");
  const [error, setError] = useState("");
  const roots = categoryTree(money.categories);
  const open = (value: typeof dialog) => {
    setDialog(value);
    setName("");
    setError("");
    setParent(value?.parent ?? "root");
    setReplacement("none");
  };
  const save = (next: typeof money.categories) => {
    const changes = next.flatMap((category) => {
      const previous = money.categories.find((c) => c.id === category.id);
      return !previous || previous.label !== category.label || previous.parent !== category.parent
        ? [{ category, previous }]
        : [];
    });
    if (!changes.length) return Promise.resolve(true);
    const apply = (current: Category[]) => {
      const result = [...current];
      for (const { category, previous } of changes) {
        const index = result.findIndex((c) => c.id === category.id);
        if (!previous) {
          if (index < 0) result.push(category);
          continue;
        }
        if (index < 0) continue;
        let row = result[index] as Category;
        if (previous.label !== category.label) row = { ...row, label: category.label };
        if (previous.parent !== category.parent) row = reparent(row, category.parent);
        result[index] = row;
      }
      return result;
    };
    return money.mutate(
      () => saveCategories(money.session, apply),
      (snapshot) => ({ ...snapshot, categories: apply(snapshot.categories) }),
    );
  };
  const focus = (id: string) => {
    setFocused(id);
    tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]').forEach((node) => {
      if (node.dataset.id === id) node.focus();
    });
  };
  const count = (id: string) => money.transactions.filter((row) => row.category === id).length;
  const render = (nodes: CategoryNode[], level: number) =>
    nodes.map((node, index) => (
      <div
        key={node.id}
        role="treeitem"
        aria-label={`${node.label}, ${count(node.id)} transactions`}
        aria-level={level}
        aria-posinset={index + 1}
        aria-setsize={nodes.length}
        aria-expanded={node.children.length ? !collapsed.has(node.id) : undefined}
        tabIndex={(focused || roots[0]?.id) === node.id ? 0 : -1}
        data-id={node.id}
        className="mon-tree-item"
        onFocus={(event) => {
          if (event.target === event.currentTarget) setFocused(node.id);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const visible = Array.from(
            tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [],
          ).filter((item) => !item.closest("[hidden]"));
          const at = visible.indexOf(event.currentTarget);
          const toggle = (close: boolean) =>
            setCollapsed((current) => {
              const next = new Set(current);
              if (close) next.add(node.id);
              else next.delete(node.id);
              return next;
            });
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            visible[
              Math.max(0, Math.min(visible.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))
            ]?.focus();
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            visible[event.key === "Home" ? 0 : visible.length - 1]?.focus();
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            if (collapsed.has(node.id)) toggle(false);
            else if (node.children[0]) focus(node.children[0].id);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            if (node.children.length && !collapsed.has(node.id)) toggle(true);
            else if (node.parent) focus(node.parent);
          } else if (event.key === "Enter" || event.key === "F2") {
            event.preventDefault();
            event.currentTarget.querySelector<HTMLButtonElement>("[data-rename] button")?.click();
          }
        }}
      >
        <div className="mon-tree-row">
          {node.children.length ? (
            <IconButton
              variant="ghost"
              label={`${collapsed.has(node.id) ? "Expand" : "Collapse"} ${node.label}`}
              onClick={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(node.id)) next.delete(node.id);
                  else next.add(node.id);
                  return next;
                })
              }
            >
              {collapsed.has(node.id) ? (
                <ChevronRight aria-hidden="true" size={16} />
              ) : (
                <ChevronDown aria-hidden="true" size={16} />
              )}
            </IconButton>
          ) : (
            <span className="mon-tree-spacer" aria-hidden="true" />
          )}
          <div className="mon-tree-name" data-rename>
            <EditableText
              label={`Rename ${node.label}`}
              value={node.label}
              validate={(value) => (value.trim() ? undefined : "Enter a category name")}
              onCommit={(label) =>
                void save(money.categories.map((c) => (c.id === node.id ? { ...c, label } : c)))
              }
            />
            <span>{count(node.id)} transactions</span>
          </div>
          <div className="mon-tree-actions">
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Add child to ${node.label}`}
              onClick={() => open({ kind: "add", parent: node.id })}
            >
              Add child
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Move ${node.label}`}
              onClick={() => open({ kind: "move", id: node.id, parent: node.parent })}
            >
              Move to…
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Delete ${node.label}`}
              onClick={() => open({ kind: "delete", id: node.id })}
            >
              Delete
            </Button>
          </div>
        </div>
        {node.children.length > 0 && (
          <fieldset className="mon-tree-children" hidden={collapsed.has(node.id)}>
            {render(node.children, level + 1)}
          </fieldset>
        )}
      </div>
    ));
  const selected = money.categories.find((c) => c.id === dialog?.id);
  return (
    <>
      <header className="mon-heading">
        <div>
          <p className="mon-eyebrow">Make it your own</p>
          <h1>Categories</h1>
          <p className="mon-subtitle">Organise spending into a tree that works for you.</p>
        </div>
        <Button onClick={() => open({ kind: "add" })}>
          <Plus size={16} aria-hidden="true" />
          Add category
        </Button>
      </header>
      <section className="mon-panel">
        <h2 className="sr-only">Category tree</h2>
        {!roots.length ? (
          <EmptyState
            title="Give your spending a home"
            body="Create your first category, then add children to group related spending."
            primaryAction={<Button onClick={() => open({ kind: "add" })}>Add category</Button>}
          />
        ) : (
          <>
            <p className="mon-hint mon-tree-hint">
              Use arrow keys to explore. Rename a category or move it to a new parent.
            </p>
            <div ref={tree} role="tree" aria-label="Categories" className="mon-tree">
              {render(roots, 1)}
            </div>
          </>
        )}
      </section>
      <Modal
        open={Boolean(dialog)}
        onOpenChange={(value) => {
          if (!value) setDialog(undefined);
        }}
        title={
          dialog?.kind === "add"
            ? "Add category"
            : dialog?.kind === "move"
              ? `Move ${selected?.label ?? "category"}`
              : `Delete ${selected?.label ?? "category"}?`
        }
        description={
          dialog?.kind === "delete"
            ? "Children move to this category's parent. Transactions need a replacement category before deletion."
            : "Group related categories under a parent, or keep them at the top level."
        }
      >
        <form
          className="mon-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            if (!dialog) return;
            if (dialog.kind === "delete") {
              const id = dialog.id;
              if (!id) return;
              if (
                await money.mutate(() =>
                  deleteCategory(
                    money.session,
                    id,
                    replacement === "none" ? undefined : replacement,
                  ),
                )
              )
                setDialog(undefined);
              return;
            }
            const next =
              dialog.kind === "add"
                ? [
                    ...money.categories,
                    {
                      id: `${storeOf(money.session).resolve("categories.ttl")}#${crypto.randomUUID()}`,
                      label: name.trim(),
                      ...(parent === "root" ? {} : { parent }),
                    },
                  ]
                : money.categories.map((c) =>
                    c.id === dialog.id ? reparent(c, parent === "root" ? undefined : parent) : c,
                  );
            try {
              categoryTree(next);
            } catch {
              setError("Choose a parent outside this category's children and enter a name.");
              return;
            }
            if (await save(next)) setDialog(undefined);
          }}
        >
          {dialog?.kind === "add" && (
            <label htmlFor="mon-categories-field-0">
              Category name
              <Input
                id="mon-categories-field-0"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
          )}
          {dialog?.kind !== "delete" ? (
            <MoneySelect
              label="Parent category"
              value={parent}
              onChange={setParent}
              options={[
                { value: "root", label: "Top level" },
                ...money.categories
                  .filter((c) => c.id !== dialog?.id)
                  .map((c) => ({ value: c.id, label: c.label })),
              ]}
            />
          ) : (
            <>
              <p>{count(dialog.id ?? "")} transactions use this category.</p>
              <MoneySelect
                label="Replacement category"
                value={replacement}
                onChange={setReplacement}
                options={[
                  { value: "none", label: "Choose a replacement" },
                  ...money.categories
                    .filter((c) => c.id !== dialog.id)
                    .map((c) => ({ value: c.id, label: c.label })),
                ]}
              />
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <Button
            type="submit"
            variant={dialog?.kind === "delete" ? "destructive" : "default"}
            disabled={money.saving}
          >
            {dialog?.kind === "delete"
              ? "Delete category"
              : dialog?.kind === "move"
                ? "Move category"
                : "Create category"}
          </Button>
        </form>
      </Modal>
    </>
  );
}
