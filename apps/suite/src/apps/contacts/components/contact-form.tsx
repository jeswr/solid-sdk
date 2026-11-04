// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  EmptyState,
  ErrorState,
  Form,
  IconButton,
  Input,
  LoadingSkeleton,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  TagInput,
  Textarea,
} from "@jeswr/suite-ui";
import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { type FieldErrors, type FieldPath, useFieldArray, useForm } from "react-hook-form";
import {
  type ContactFormValues,
  contactFormData,
  contactFormDefaults,
  contactFormSchemaFor,
  emptyAddress,
} from "../lib/form-schema";
import { duplicateContacts } from "../lib/import-export";
import type { ContactData, Snapshot } from "../lib/model";
import { useContact, useContactMutations } from "../state/contacts-context";
import { type ContactPatch, contactLabels, encodeContactRef } from "../state/data";

export function ContactEditor({ contactRef }: { contactRef?: string }) {
  const state = useContact(contactRef ?? "");
  if (state.status === "loading")
    return <LoadingSkeleton preset="detail" label="Loading contact form" />;
  if (state.status === "error")
    return <ErrorState error="unreachable" actions={{ retry: state.retry }} />;
  if (!state.book)
    return (
      <EmptyState
        title="Create your address book first"
        primaryAction={
          <Button
            onClick={() => {
              void state.createAddressBook().catch(() => {});
            }}
          >
            Create address book
          </Button>
        }
      />
    );
  if (contactRef && !state.contact)
    return (
      <EmptyState
        title="Contact not found"
        primaryAction={<Link href="/contacts">Back to contacts</Link>}
      />
    );
  return (
    <ContactDraft
      key={state.contact?.url ?? "new"}
      bookUrl={state.book.url}
      person={state.contact}
    />
  );
}
function ContactDraft({
  bookUrl,
  person,
}: {
  bookUrl: string;
  person: Snapshot<ContactData> | undefined;
}) {
  const state = useContact("");
  const mutations = useContactMutations();
  const router = useRouter();
  const id = person ? `${person.url}#this` : undefined;
  const initialLabels = useRef(
    id ? contactLabels(id, state.data.groups).map((group) => `${group.url}#this`) : [],
  ).current;
  const defaults = useRef(contactFormDefaults(person?.data, initialLabels)).current;
  // Unchanged addresses skip the limits, so contacts other apps wrote stay editable.
  const schema = useRef(contactFormSchemaFor(defaults.addresses)).current;
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
    shouldFocusError: false,
  });
  const formElement = useRef<HTMLFormElement>(null);
  const emails = useFieldArray({ control: form.control, name: "emails" });
  const phones = useFieldArray({ control: form.control, name: "phones" });
  const addresses = useFieldArray({ control: form.control, name: "addresses" });
  const addressListError = () =>
    form.formState.errors.addresses?.root?.message ?? form.formState.errors.addresses?.message;
  // AUTHORED-BY Claude Opus 5.5
  const addressList = useRef<HTMLDivElement>(null);
  const removeAddress = (index: number) => {
    const groups = addressList.current?.querySelectorAll<HTMLFieldSetElement>(":scope > fieldset");
    // Focus the next surviving address (or the previous one, else Add address) by its DOM node.
    const target =
      groups?.[index + 1]?.querySelector<HTMLElement>("select") ??
      groups?.[index - 1]?.querySelector<HTMLElement>("select") ??
      addressList.current?.parentElement?.querySelector<HTMLButtonElement>(":scope > button");
    addresses.remove(index);
    target?.focus();
  };
  const focusInvalid = (invalid: FieldErrors<ContactFormValues>) => {
    // Appended rows register last, so RHF's registration order differs from the DOM.
    const fields = formElement.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input[name], textarea[name]",
    );
    for (const field of fields ?? []) {
      if (form.getFieldState(field.name as FieldPath<ContactFormValues>).invalid) {
        field.focus();
        return;
      }
    }
    // A list-level address error (too many) has no input of its own: focus Add address.
    if (invalid.addresses?.root?.message ?? invalid.addresses?.message)
      addressList.current?.parentElement
        ?.querySelector<HTMLButtonElement>(":scope > button")
        ?.focus();
  };
  const removePoint = (
    remove: (index: number) => void,
    index: number,
    button: HTMLButtonElement,
  ) => {
    const fieldset = button.closest("fieldset") as HTMLFieldSetElement;
    const fields = fieldset.querySelectorAll<HTMLInputElement>("input");
    // Keep the surviving DOM node: its field name changes when the rows are reindexed.
    const target =
      fields[index + 1] ??
      fields[index - 1] ??
      fieldset.querySelector<HTMLButtonElement>(":scope > button");
    remove(index);
    target?.focus();
  };
  const [wide, setWide] = useState(false);
  const [discard, setDiscard] = useState(false);
  const submitted = useRef(false);
  const submitting = useRef(false);
  const title = person ? "Edit contact" : "New contact";
  const destination = person ? `/contacts/c/${encodeContactRef(bookUrl, person.url)}` : "/contacts";
  const dirty = form.formState.isDirty;
  const errors = form.formState.errors;
  const values = form.watch();
  const validation = schema.safeParse(values);
  const errorCount =
    form.formState.submitCount && !validation.success ? validation.error.issues.length : 0;
  const cancel = () => {
    if (dirty) setDiscard(true);
    else router.push(destination);
  };
  useEffect(() => {
    const media = matchMedia("(min-width: 1024px)");
    const sync = () => setWide(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty && !submitted.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    addEventListener("beforeunload", unload);
    return () => removeEventListener("beforeunload", unload);
  }, [dirty]);
  const input = (
    name:
      | "name"
      | "organization"
      | "webId"
      | `emails.${number}.value`
      | `phones.${number}.value`
      | `addresses.${number}.${"locality" | "region" | "postalCode" | "country"}`,
    label: string,
    type = "text",
    autoComplete?: string,
  ) => {
    const error = form.getFieldState(name, form.formState).error;
    const fieldId = `con-${name}`;
    return (
      <div className="con-field">
        <label htmlFor={fieldId}>{label}</label>
        <Input
          id={fieldId}
          type={type}
          autoComplete={autoComplete}
          {...form.register(name)}
          aria-required={name === "name"}
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId}-error` : undefined}
        />
        {error && (
          <p id={`${fieldId}-error`} role="alert" className="con-field-error">
            {error.message}
          </p>
        )}
      </div>
    );
  };
  const content = (
    <>
      <Form {...form}>
        <form
          ref={formElement}
          className="con-form"
          noValidate
          onSubmit={form.handleSubmit((values) => {
            if (submitting.current) return;
            submitting.current = true;
            const data = contactFormData(values, schema);
            const url = person?.url ?? new URL(`people/${crypto.randomUUID()}.ttl`, bookUrl).href;
            const contactId = `${url}#this`;
            // Publish immediately, then leave persistence and rollback with the shared controller.
            if (person) {
              const patch: ContactPatch = {};
              for (const field of [
                "name",
                "organization",
                "emails",
                "phones",
                "addresses",
                "webId",
                "note",
              ] as const) {
                if (form.formState.dirtyFields[field])
                  Object.assign(patch, { [field]: data[field] });
              }
              if (Object.keys(patch).length)
                void mutations.update(contactId, patch).catch(() => {});
            } else {
              const created: ContactData = {
                name: data.name,
                emails: data.emails,
                phones: data.phones,
              };
              if (data.addresses.length) created.addresses = data.addresses;
              if (data.organization !== undefined) created.organization = data.organization;
              if (data.note !== undefined) created.note = data.note;
              if (data.webId !== undefined) created.webId = data.webId;
              void mutations.create(created, url).catch(() => {});
            }
            for (const label of new Set([...initialLabels, ...values.labels])) {
              if (initialLabels.includes(label) !== values.labels.includes(label))
                void mutations
                  .setLabel(contactId, label, values.labels.includes(label))
                  .catch(() => {});
            }
            submitted.current = true;
            router.push(`/contacts/c/${encodeContactRef(bookUrl, url)}`);
          }, focusInvalid)}
        >
          <div role="status" aria-live="polite" aria-atomic="true" className="con-form-summary">
            {errorCount
              ? `${errorCount} ${errorCount === 1 ? "field needs" : "fields need"} attention`
              : ""}
          </div>
          {input("name", "Full name")}
          {input("organization", "Organisation")}
          <fieldset>
            <legend>Emails</legend>
            {emails.fields.map((field, index) => {
              const email = values.emails[index]?.value ?? "";
              const duplicates = duplicateContacts(
                { name: "", emails: [email] },
                state.data.people
                  .filter((other) => other.url !== person?.url)
                  .map((other) => other.data),
                false,
              );
              return (
                <div key={field.id}>
                  <div className="con-point-row">
                    {input(`emails.${index}.value`, `Email ${index + 1}`, "email")}
                    <IconButton
                      label={`Remove email ${index + 1}`}
                      type="button"
                      variant="ghost"
                      onClick={(event) => removePoint(emails.remove, index, event.currentTarget)}
                    >
                      <X aria-hidden="true" size={16} />
                    </IconButton>
                  </div>
                  {duplicates.map((duplicate) => {
                    const match = state.data.people.find(
                      (other) => other.data === duplicate,
                    ) as Snapshot<ContactData>;
                    return (
                      <p className="con-duplicate" key={match.url}>
                        <Link href={`/contacts/c/${encodeContactRef(bookUrl, match.url)}`}>
                          {duplicate.name} already uses this email
                        </Link>
                      </p>
                    );
                  })}
                </div>
              );
            })}
            <Button
              type="button"
              variant="ghost"
              onClick={() => emails.append({ value: "" }, { shouldFocus: true })}
            >
              <Plus size={16} aria-hidden="true" />
              Add email
            </Button>
          </fieldset>
          <fieldset>
            <legend>Phones</legend>
            <p className="con-field-help">
              Use an international number with + and country code. Extensions cannot be saved.
            </p>
            {phones.fields.map((field, index) => (
              <div className="con-point-row" key={field.id}>
                {input(`phones.${index}.value`, `Phone ${index + 1}`, "tel")}
                <IconButton
                  label={`Remove phone ${index + 1}`}
                  type="button"
                  variant="ghost"
                  onClick={(event) => removePoint(phones.remove, index, event.currentTarget)}
                >
                  <X aria-hidden="true" size={16} />
                </IconButton>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              onClick={() => phones.append({ value: "" }, { shouldFocus: true })}
            >
              <Plus size={16} aria-hidden="true" />
              Add phone
            </Button>
          </fieldset>
          <fieldset aria-describedby={addressListError() ? "con-addresses-error" : undefined}>
            <legend>Addresses</legend>
            {addressListError() && (
              <p id="con-addresses-error" role="alert" className="con-field-error">
                {addressListError()}
              </p>
            )}
            <div ref={addressList} className="con-address-list">
              {addresses.fields.map((field, index) => {
                const n = index + 1;
                const street = `addresses.${index}.street` as const;
                const streetError = form.getFieldState(street, form.formState).error;
                return (
                  <fieldset key={field.id} className="con-address">
                    <legend className="sr-only">Address {n}</legend>
                    <div className="con-point-row">
                      <div className="con-field">
                        <label htmlFor={`con-addresses.${index}.kind`}>Address {n} type</label>
                        <select
                          id={`con-addresses.${index}.kind`}
                          className="con-select"
                          {...form.register(`addresses.${index}.kind`)}
                        >
                          <option value="">Other</option>
                          <option value="home">Home</option>
                          <option value="work">Work</option>
                        </select>
                      </div>
                      <IconButton
                        label={`Remove address ${n}`}
                        type="button"
                        variant="ghost"
                        onClick={() => removeAddress(index)}
                      >
                        <X aria-hidden="true" size={16} />
                      </IconButton>
                    </div>
                    <div className="con-field">
                      <label htmlFor={`con-${street}`}>Street</label>
                      <Textarea
                        id={`con-${street}`}
                        rows={2}
                        autoComplete="street-address"
                        {...form.register(street)}
                        aria-invalid={!!streetError}
                        aria-describedby={streetError ? `con-${street}-error` : undefined}
                      />
                      {streetError && (
                        <p id={`con-${street}-error`} role="alert" className="con-field-error">
                          {streetError.message}
                        </p>
                      )}
                    </div>
                    <div className="con-address-grid">
                      {input(`addresses.${index}.locality`, "City", "text", "address-level2")}
                      {input(
                        `addresses.${index}.region`,
                        "State or region",
                        "text",
                        "address-level1",
                      )}
                      {input(`addresses.${index}.postalCode`, "Postal code", "text", "postal-code")}
                      {input(`addresses.${index}.country`, "Country", "text", "country-name")}
                    </div>
                  </fieldset>
                );
              })}
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => addresses.append(emptyAddress(), { shouldFocus: true })}
            >
              <Plus size={16} aria-hidden="true" />
              Add address
            </Button>
          </fieldset>
          {input("webId", "WebID", "url")}
          <div className="con-field">
            <label htmlFor="con-note">Note</label>
            <Textarea id="con-note" {...form.register("note")} />
          </div>
          <TagInput
            label="Labels"
            options={state.data.groups.map((group) => ({
              id: `${group.url}#this`,
              label: group.data.name,
            }))}
            value={values.labels}
            onChange={(labels) => form.setValue("labels", labels, { shouldDirty: true })}
          />
          <div className="con-form-actions">
            <Button type="submit">Save contact</Button>
            <Button variant="outline" type="button" onClick={cancel}>
              Cancel
            </Button>
          </div>
          {errors.root && <p role="alert">{errors.root.message}</p>}
        </form>
      </Form>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogTitle>Discard changes?</AlertDialogTitle>
          <AlertDialogDescription>Your unsaved changes will be lost.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                submitted.current = true;
                router.push(destination);
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
  return wide ? (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <SheetContent
        side="right"
        className="con-form-sheet"
        showCloseButton={false}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          cancel();
        }}
      >
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>Keep contact details in your address book.</SheetDescription>
        {content}
      </SheetContent>
    </Sheet>
  ) : (
    <section className="con-form-page" aria-label={title}>
      <h1>{title}</h1>
      {content}
    </section>
  );
}
