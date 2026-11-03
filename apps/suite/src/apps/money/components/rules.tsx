// AUTHORED-BY Claude Opus 5.5
"use client";
import { Button, EmptyState, IconButton, Input } from "@jeswr/suite-ui";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  addRule,
  categoriseByRules,
  checkRule,
  type RuleMatch,
  replaceRule,
  resetRules,
  ruleMatches,
  type SavedRule,
  saveRules,
} from "../lib/data/rules";
import { useMoney } from "../state/money-context";
import { CategorySelect, Modal, MoneySelect } from "./money-forms";

const MATCH_LABELS: Record<RuleMatch, string> = {
  contains: "contains",
  startsWith: "starts with",
  endsWith: "ends with",
  equals: "is exactly",
};
const count = (value: number, noun: string) =>
  `${value.toLocaleString("en")} ${noun}${value === 1 ? "" : "s"}`;

/** A new rule's id is fixed when its dialog opens, so retrying a save adds it once. */
type Draft = {
  id: string;
  isNew: boolean;
  match: RuleMatch;
  value: string;
  category?: string | undefined;
};

export function RulesScreen() {
  const money = useMoney();
  const valueId = useId();
  const [draft, setDraft] = useState<Draft>();
  const [deleting, setDeleting] = useState<SavedRule>();
  const [error, setError] = useState<{ field: "value" | "category"; text: string }>();
  const [announcement, setAnnouncement] = useState("");
  // After a move, keep focus on the same control of the moved rule.
  const focusAfterMove = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!focusAfterMove.current) return;
    document.querySelector<HTMLElement>(`[data-rule-control="${focusAfterMove.current}"]`)?.focus();
    focusAfterMove.current = undefined;
  });
  const label = (id: string) => money.categories.find((c) => c.id === id)?.label;
  const describe = (rule: SavedRule) => `Description ${MATCH_LABELS[rule.match]} “${rule.value}”`;
  const matches = useMemo(
    () => ruleMatches(money.rules, money.categories, money.transactions),
    [money.rules, money.categories, money.transactions],
  );
  const matched = [...matches.values()].reduce((total, ids) => total + ids.length, 0);

  const change = (update: (rules: SavedRule[]) => SavedRule[]) =>
    money.mutate(
      () => saveRules(money.session, update),
      (snapshot) => {
        try {
          return { ...snapshot, rules: update([...snapshot.rules]) };
        } catch {
          // The save reports the conflict; show the rules as they were meanwhile.
          return snapshot;
        }
      },
    );
  const move = (rule: SavedRule, by: -1 | 1) => {
    const from = money.rules.findIndex((value) => value.id === rule.id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= money.rules.length) return;
    // At the new end, the button just used no longer applies; use the other one.
    const end = to === 0 || to === money.rules.length - 1;
    focusAfterMove.current = `${rule.id}:${end ? (by < 0 ? "down" : "up") : by < 0 ? "up" : "down"}`;
    setAnnouncement(`Moved to position ${to + 1} of ${money.rules.length}`);
    void change((rules) => {
      const index = rules.findIndex((value) => value.id === rule.id);
      const target = index + by;
      if (index < 0 || target < 0 || target >= rules.length) return rules;
      const next = [...rules];
      next.splice(target, 0, ...next.splice(index, 1));
      return next;
    });
  };
  const apply = () =>
    void money.mutate(async () => {
      const filed = await categoriseByRules(money.session, money.rules, money.categories);
      setAnnouncement(`Categorised ${count(filed, "transaction")}`);
    });
  const openDraft = (value: Draft) => {
    setError(undefined);
    // A rule whose category was deleted must pick a new one before saving.
    const known = money.categories.some((category) => category.id === value.category);
    setDraft({ ...value, category: known ? value.category : undefined });
  };
  const newDraft = () =>
    openDraft({ id: crypto.randomUUID(), isNew: true, match: "contains", value: "" });

  return (
    <>
      <header className="mon-heading">
        <div>
          <p className="mon-eyebrow">Make it your own</p>
          <h1>Rules</h1>
          <p className="mon-subtitle">
            File imported transactions automatically. The first rule that matches wins.
          </p>
        </div>
        <Button disabled={!money.categories.length} onClick={newDraft}>
          <Plus size={16} aria-hidden="true" />
          Add rule
        </Button>
      </header>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {money.rulesUnreadable && (
        <div className="mon-rules-warning" role="status">
          <p>
            Your saved rules couldn&apos;t be read, so imports use category names instead. Start
            again with no rules to add new ones.
          </p>
          <Button
            variant="outline"
            disabled={money.saving}
            onClick={() => void money.mutate(() => resetRules(money.session))}
          >
            Start again with no rules
          </Button>
        </div>
      )}
      <section className="mon-panel">
        <h2 className="sr-only">Your rules</h2>
        {!money.categories.length ? (
          <EmptyState
            title="Add a category first"
            body="Rules file transactions into categories, so create at least one category."
            primaryAction={
              <Button asChild>
                <Link href="/money/categories">Go to categories</Link>
              </Button>
            }
          />
        ) : money.rulesUnreadable ? null : !money.rules.length ? (
          <EmptyState
            title="Sort transactions automatically"
            body="For example: when the description contains “Tesco”, file it under Groceries. Without rules, imports look for category names in descriptions."
            primaryAction={<Button onClick={newDraft}>Add rule</Button>}
          />
        ) : (
          <ol className="mon-rules">
            {money.rules.map((rule, index) => (
              <li key={rule.id} className="mon-rule">
                <span className="mon-rule-text">
                  {describe(rule)}
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only">, file under </span>
                  <strong>{label(rule.category) ?? "Deleted category (rule is skipped)"}</strong>
                </span>
                <span className="mon-rule-actions">
                  <IconButton
                    label={`Move up: ${describe(rule)}`}
                    variant="ghost"
                    data-rule-control={`${rule.id}:up`}
                    disabled={index === 0}
                    onClick={() => move(rule, -1)}
                  >
                    <ArrowUp size={16} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Move down: ${describe(rule)}`}
                    variant="ghost"
                    data-rule-control={`${rule.id}:down`}
                    disabled={index === money.rules.length - 1}
                    onClick={() => move(rule, 1)}
                  >
                    <ArrowDown size={16} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Edit: ${describe(rule)}`}
                    variant="ghost"
                    onClick={() => openDraft({ ...rule, isNew: false })}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Delete: ${describe(rule)}`}
                    variant="ghost"
                    onClick={() => setDeleting(rule)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </IconButton>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      {matched > 0 && (
        <section className="mon-panel mon-rules-apply" aria-labelledby="mon-rules-apply-title">
          <h2 id="mon-rules-apply-title">Existing transactions</h2>
          <p>
            {count(matched, "uncategorised transaction")} {matched === 1 ? "matches" : "match"} your
            rules.
          </p>
          <Button variant="outline" disabled={money.saving} onClick={apply}>
            Categorise {count(matched, "transaction")}
          </Button>
        </section>
      )}
      <Modal
        open={Boolean(draft)}
        onOpenChange={(open) => {
          if (!open) setDraft(undefined);
        }}
        title={draft?.isNew === false ? "Edit rule" : "Add rule"}
        description="Rules apply to new imports. Existing transactions can be categorised from this page."
      >
        {draft && (
          <form
            className="mon-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setError(undefined);
              let rule: SavedRule;
              try {
                rule = checkRule({
                  id: draft.id,
                  match: draft.match,
                  value: draft.value,
                  category: draft.category ?? "",
                });
              } catch (failure) {
                const text = (failure as Error).message;
                setError({ field: /category/u.test(text) ? "category" : "value", text });
                return;
              }
              const saved = await change((rules) =>
                draft.isNew ? addRule(rules, rule) : replaceRule(rules, rule),
              );
              if (saved) setDraft(undefined);
            }}
          >
            <MoneySelect
              label="When the description"
              value={draft.match}
              onChange={(match) => setDraft({ ...draft, match: match as RuleMatch })}
              options={Object.entries(MATCH_LABELS).map(([value, text]) => ({
                value,
                label: text,
              }))}
            />
            <label htmlFor={valueId}>
              Text
              <Input
                id={valueId}
                value={draft.value}
                maxLength={200}
                onChange={(event) => setDraft({ ...draft, value: event.target.value })}
                aria-invalid={error?.field === "value" ? true : undefined}
                aria-describedby={error?.field === "value" ? `${valueId}-error` : undefined}
              />
            </label>
            {error?.field === "value" && (
              <p id={`${valueId}-error`} role="alert" className="mon-rules-error">
                {error.text}
              </p>
            )}
            <CategorySelect
              label="File under"
              value={draft.category}
              onChange={(category) => setDraft({ ...draft, category })}
            />
            {error?.field === "category" && (
              <p role="alert" className="mon-rules-error">
                {error.text}
              </p>
            )}
            <Button type="submit" disabled={money.saving}>
              Save rule
            </Button>
          </form>
        )}
      </Modal>
      <Modal
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title="Delete rule?"
        description={deleting ? describe(deleting) : ""}
      >
        <div className="mon-form">
          <p>Transactions already filed by this rule keep their category.</p>
          <Button
            variant="destructive"
            disabled={money.saving}
            onClick={async () => {
              const rule = deleting;
              if (!rule) return;
              if (await change((rules) => rules.filter((value) => value.id !== rule.id)))
                setDeleting(undefined);
            }}
          >
            Delete rule
          </Button>
        </div>
      </Modal>
    </>
  );
}
