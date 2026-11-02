// AUTHORED-BY Claude Opus 5.5
"use client";
import { Button, EmptyState, IconButton, Input } from "@jeswr/suite-ui";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { bulkCategorise } from "../lib/data/ledger";
import {
  checkRule,
  type RuleMatch,
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

type Draft = { id?: string; match: RuleMatch; value: string; category?: string | undefined };

export function RulesScreen() {
  const money = useMoney();
  const valueId = useId();
  const [draft, setDraft] = useState<Draft>();
  const [deleting, setDeleting] = useState<SavedRule>();
  const [error, setError] = useState("");
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
      (snapshot) => ({ ...snapshot, rules: update([...snapshot.rules]) }),
    );
  const move = (rule: SavedRule, by: -1 | 1) =>
    void change((rules) => {
      const from = rules.findIndex((value) => value.id === rule.id);
      const to = from + by;
      if (from < 0 || to < 0 || to >= rules.length) return rules;
      const next = [...rules];
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
  const apply = () =>
    void money.mutate(async () => {
      for (const [category, ids] of matches) await bulkCategorise(money.session, ids, category);
    });

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
        <Button
          disabled={!money.categories.length}
          onClick={() => {
            setError("");
            setDraft({ match: "contains", value: "" });
          }}
        >
          <Plus size={16} aria-hidden="true" />
          Add rule
        </Button>
      </header>
      {money.rulesUnreadable && (
        <p className="mon-rules-warning" role="status">
          Your saved rules couldn&apos;t be read. Imports use category names until they&apos;re
          fixed; saving a rule will try again.
        </p>
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
        ) : !money.rules.length ? (
          <EmptyState
            title="Sort transactions automatically"
            body="For example: when the description contains “Tesco”, file it under Groceries. Without rules, imports look for category names in descriptions."
            primaryAction={
              <Button onClick={() => setDraft({ match: "contains", value: "" })}>Add rule</Button>
            }
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
                    disabled={index === 0 || money.saving}
                    onClick={() => move(rule, -1)}
                  >
                    <ArrowUp size={16} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Move down: ${describe(rule)}`}
                    variant="ghost"
                    disabled={index === money.rules.length - 1 || money.saving}
                    onClick={() => move(rule, 1)}
                  >
                    <ArrowDown size={16} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Edit: ${describe(rule)}`}
                    variant="ghost"
                    onClick={() => {
                      setError("");
                      setDraft(rule);
                    }}
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
        title={draft?.id ? "Edit rule" : "Add rule"}
        description="Rules apply to new imports. Existing transactions can be categorised from this page."
      >
        {draft && (
          <form
            className="mon-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setError("");
              let rule: SavedRule;
              try {
                rule = checkRule({
                  id: draft.id ?? crypto.randomUUID(),
                  match: draft.match,
                  value: draft.value,
                  category: draft.category ?? "",
                });
              } catch (failure) {
                setError((failure as Error).message);
                return;
              }
              const saved = await change((rules) =>
                rules.some((value) => value.id === rule.id)
                  ? rules.map((value) => (value.id === rule.id ? rule : value))
                  : [...rules, rule],
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
                aria-describedby={error ? `${valueId}-error` : undefined}
              />
            </label>
            <CategorySelect
              label="File under"
              value={draft.category}
              onChange={(category) => setDraft({ ...draft, category })}
            />
            {error && (
              <p id={`${valueId}-error`} role="alert" className="mon-rules-error">
                {error}
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
