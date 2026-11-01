// AUTHORED-BY Codex GPT-6
"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@jeswr/suite-ui";
import { useEffect, useId, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { type AccountSummary, accountTypes, createAccount } from "../lib/data/accounts";
import { addTransaction, categorised, createTransfer, updateTransaction } from "../lib/data/ledger";
import type { Transaction } from "../lib/model";
import { parseMoney } from "../lib/reports";
import { useMoney } from "../state/money-context";
export function MoneySelect({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  disabled?: boolean | undefined;
}) {
  const id = useId();
  return (
    <div className="mon-field">
      <label htmlFor={id}>{label}</label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
export function CategorySelect({
  value,
  onChange,
  label = "Category",
  disabled,
}: {
  value?: string | undefined;
  onChange: (value: string | undefined) => void;
  label?: string;
  disabled?: boolean | undefined;
}) {
  const { categories } = useMoney();
  return (
    <MoneySelect
      label={label}
      value={value || "none"}
      onChange={(value) => onChange(value === "none" ? undefined : value)}
      disabled={disabled}
      options={[
        { value: "none", label: "Uncategorised" },
        ...categories.map((c) => ({ value: c.id, label: c.label })),
      ]}
    />
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const trigger = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="mon-dialog"
        onOpenAutoFocus={() => {
          trigger.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (trigger.current?.isConnected
            ? trigger.current
            : document.getElementById("main-content")
          )?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
const decimal = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/, "Enter a decimal amount, such as 12.50");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
    "Choose a valid date",
  );
const accountSchema = z
  .object({
    name: z.string().trim().min(1, "Enter an account name"),
    type: z.enum(accountTypes),
    currency: z.string().regex(/^[A-Z]{3}$/, "Use a three-letter currency"),
    openingBalance: decimal,
    date,
  })
  .superRefine((input, context) => {
    try {
      parseMoney(input.currency, input.openingBalance);
    } catch {
      context.addIssue({
        code: "custom",
        path: ["openingBalance"],
        message: "Choose a supported currency and an amount with the correct decimal places.",
      });
    }
  });
export function AccountDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}) {
  const money = useMoney();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof accountSchema>>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: "",
      type: "current",
      currency: "GBP",
      openingBalance: "0",
      date: money.today,
    },
  });
  useEffect(() => {
    if (open)
      reset({ name: "", type: "current", currency: "GBP", openingBalance: "0", date: money.today });
  }, [open, reset, money.today]);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add account"
      description="Start with the balance on your opening date."
    >
      <form
        className="mon-form"
        onSubmit={handleSubmit(async (input) => {
          let id = "";
          const saved = await money.mutate(async () => {
            id = (await createAccount(money.session, crypto.randomUUID(), input)).id;
          });
          if (saved) {
            onCreated?.(id);
            onOpenChange(false);
          }
        })}
      >
        <label htmlFor="mon-money-forms-field-0">
          Account name
          <Input
            id="mon-money-forms-field-0"
            aria-describedby="mon-account-errors"
            {...register("name")}
            aria-invalid={Boolean(errors.name)}
          />
        </label>
        <MoneySelect
          label="Account type"
          value={watch("type")}
          onChange={(value) => setValue("type", value as (typeof accountTypes)[number])}
          options={accountTypes.map((value) => ({
            value,
            label: value.charAt(0).toUpperCase() + value.slice(1),
          }))}
        />
        <label htmlFor="mon-money-forms-field-1">
          Currency
          <Input
            id="mon-money-forms-field-1"
            aria-describedby="mon-account-errors"
            {...register("currency")}
            maxLength={3}
            list="mon-currencies"
          />
        </label>
        <datalist id="mon-currencies">
          {["GBP", "EUR", "USD", "JPY", "CHF", "CAD", "AUD"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </datalist>
        <label htmlFor="mon-money-forms-field-2">
          Opening balance
          <Input
            id="mon-money-forms-field-2"
            aria-describedby="mon-account-errors"
            {...register("openingBalance")}
            inputMode="decimal"
          />
        </label>
        <label htmlFor="mon-money-forms-field-3">
          Opening date
          <Input
            id="mon-money-forms-field-3"
            aria-describedby="mon-account-errors"
            {...register("date")}
            type="date"
          />
        </label>
        <FormErrors errors={errors} id="mon-account-errors" />
        <p className="mon-hint">
          Balances are kept separately for each currency. No exchange rates are applied.
        </p>
        <Button type="submit" disabled={isSubmitting}>
          Add account
        </Button>
      </form>
    </Modal>
  );
}
const transactionSchema = z.object({
  date,
  description: z.string().trim().min(1, "Enter a payee or description"),
  amount: decimal.refine(
    (value) => !value.startsWith("-") && Number(value) > 0,
    "Enter a positive amount",
  ),
  direction: z.enum(["out", "in"]),
  category: z.string(),
  note: z.string(),
});
export function TransactionDialog({
  account,
  open,
  onOpenChange,
  transaction,
}: {
  account: AccountSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction?: Transaction | undefined;
}) {
  const money = useMoney();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof transactionSchema>>({ resolver: zodResolver(transactionSchema) });
  useEffect(() => {
    if (open)
      reset({
        date: transaction?.postingTime.slice(0, 10) ?? money.today,
        description: transaction?.description ?? "",
        amount: transaction?.amount.replace("-", "") ?? "",
        direction: transaction?.amount.startsWith("-") === false ? "in" : "out",
        category: transaction?.category ?? "",
        note: "",
      });
  }, [open, transaction, reset, money.today]);
  const transfer = Boolean(transaction?.debitAccount || transaction?.creditAccount);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={transaction ? "Edit transaction" : "Add transaction"}
      description={
        transfer
          ? "This is a paired transfer. Transfer legs must be changed together; editing transfers is not supported yet."
          : `Record money going in or out of ${account.label}.`
      }
    >
      {transfer ? (
        <Button onClick={() => onOpenChange(false)}>Done</Button>
      ) : (
        <form
          className="mon-form"
          onSubmit={handleSubmit(async (input) => {
            const amount = input.direction === "out" ? `-${input.amount}` : input.amount;
            const value = {
              account: account.id,
              postingTime: input.date,
              description: input.note ? `${input.description}\n${input.note}` : input.description,
              amount,
              currency: account.currency,
              ...(input.category ? { category: input.category } : {}),
            };
            const saved = await money.mutate(
              () =>
                transaction
                  ? updateTransaction(
                      money.session,
                      transaction,
                      categorised({ ...transaction, ...value }, input.category || undefined),
                    )
                  : addTransaction(money.session, crypto.randomUUID(), value),
              transaction
                ? (snapshot) => ({
                    ...snapshot,
                    transactions: snapshot.transactions.map((row) =>
                      row.id === transaction.id
                        ? categorised({ ...row, ...value }, input.category || undefined)
                        : row,
                    ),
                  })
                : undefined,
            );
            if (saved) onOpenChange(false);
          })}
        >
          <label htmlFor="mon-money-forms-field-4">
            Date
            <Input
              id="mon-money-forms-field-4"
              aria-describedby="mon-transaction-errors"
              type="date"
              {...register("date")}
            />
          </label>
          <label htmlFor="mon-money-forms-field-5">
            Payee / description
            <Input
              id="mon-money-forms-field-5"
              aria-describedby="mon-transaction-errors"
              {...register("description")}
            />
          </label>
          <MoneySelect
            label="Direction"
            value={watch("direction") || "out"}
            onChange={(value) => setValue("direction", value as "in" | "out")}
            options={[
              { value: "out", label: "Money out" },
              { value: "in", label: "Money in" },
            ]}
          />
          <label htmlFor="mon-money-forms-field-6">
            Amount ({account.currency})
            <Input
              id="mon-money-forms-field-6"
              aria-describedby="mon-transaction-errors"
              inputMode="decimal"
              {...register("amount")}
            />
          </label>
          <CategorySelect
            value={watch("category")}
            onChange={(value) => setValue("category", value ?? "")}
          />
          <label htmlFor="mon-money-forms-field-7">
            Note (optional)
            <Input
              id="mon-money-forms-field-7"
              aria-describedby="mon-transaction-errors"
              {...register("note")}
            />
          </label>
          <FormErrors errors={errors} id="mon-transaction-errors" />
          <Button type="submit" disabled={isSubmitting}>
            {transaction ? "Save transaction" : "Add transaction"}
          </Button>
        </form>
      )}
    </Modal>
  );
}
const transferSchema = z.object({
  to: z.string().min(1, "Choose a destination account"),
  amount: decimal.refine(
    (value) => !value.startsWith("-") && Number(value) > 0,
    "Enter a positive amount",
  ),
  date,
});
export function TransferDialog({
  account,
  open,
  onOpenChange,
}: {
  account: AccountSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const money = useMoney();
  const eligible = money.accounts.filter(
    (a) => a.id !== account.id && a.currency === account.currency,
  );
  const {
    register,
    watch,
    setValue,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof transferSchema>>({
    resolver: zodResolver(transferSchema),
    defaultValues: { to: "", amount: "", date: money.today },
  });
  useEffect(() => {
    if (open) reset({ to: "", amount: "", date: money.today });
  }, [open, reset, money.today]);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Transfer"
      description={`Move money from ${account.label}. Both accounts must use ${account.currency}.`}
    >
      <form
        className="mon-form"
        onSubmit={handleSubmit(async (input) => {
          const to = eligible.find((a) => a.id === input.to);
          if (!to) return;
          if (
            await money.mutate(() =>
              createTransfer(
                money.session,
                crypto.randomUUID(),
                account,
                to,
                input.date,
                input.amount,
              ),
            )
          )
            onOpenChange(false);
        })}
      >
        <MoneySelect
          label="To account"
          value={watch("to")}
          onChange={(value) => setValue("to", value)}
          options={eligible.map((a) => ({ value: a.id, label: a.label }))}
        />
        {!eligible.length && <p>Add another account in {account.currency} to make a transfer.</p>}
        <label htmlFor="mon-money-forms-field-8">
          Amount ({account.currency})
          <Input
            id="mon-money-forms-field-8"
            aria-describedby="mon-transfer-errors"
            inputMode="decimal"
            {...register("amount")}
          />
        </label>
        <label htmlFor="mon-money-forms-field-9">
          Date
          <Input
            id="mon-money-forms-field-9"
            aria-describedby="mon-transfer-errors"
            type="date"
            {...register("date")}
          />
        </label>
        <FormErrors errors={errors} id="mon-transfer-errors" />
        <Button type="submit" disabled={!eligible.length || isSubmitting}>
          Create transfer
        </Button>
      </form>
    </Modal>
  );
}
function FormErrors({ errors, id }: { errors: Record<string, { message?: string }>; id: string }) {
  return (
    <div role="alert" id={id}>
      {Object.entries(errors).map(([key, error]) => (
        <p key={key}>{error.message}</p>
      ))}
    </div>
  );
}
export function Amount({
  amount,
  currency,
  signed = false,
}: {
  amount: string;
  currency: string;
  signed?: boolean;
}) {
  // Format the integer with Intl, then substitute the exact decimal fraction.
  // Passing the complete amount through Number would round large balances.
  const [whole, fraction = ""] = amount.split(".");
  const defaults = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).resolvedOptions();
  const minimum = Math.max(defaults.minimumFractionDigits ?? 0, fraction ? 1 : 0);
  const formatter = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: minimum,
    maximumFractionDigits: Math.max(defaults.maximumFractionDigits ?? 0, minimum),
  });
  const value = whole === "-0" ? -0 : BigInt(whole as string);
  const formatted = formatter
    .formatToParts(value)
    .map((part) => (part.type === "fraction" ? fraction.padEnd(minimum, "0") : part.value))
    .join("");
  return (
    <span className={`mon-amount ${amount.startsWith("-") ? "mon-negative" : ""}`}>
      {signed && !amount.startsWith("-") ? "+" : ""}
      {formatted}
    </span>
  );
}
