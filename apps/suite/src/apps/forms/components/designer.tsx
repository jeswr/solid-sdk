// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Button,
  Checkbox,
  IconButton,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from "@jeswr/suite-ui";
import { ArrowDown, ArrowUp, Copy, GripVertical, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  designerIssues,
  duplicateQuestion,
  moveQuestion,
  newQuestion,
  type QuestionKind,
  questionKinds,
} from "../lib/designer";
import type { FieldDescriptor, FormModel } from "../lib/runtime";
import { useForms } from "../state/forms-context";
import { AnswerForm } from "./answer-form";

function QuestionEditor({
  field,
  form,
  index,
  change,
}: {
  field: FieldDescriptor;
  form: FormModel;
  index: number;
  change: (form: FormModel) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: field.key,
  });
  const update = (patch: Partial<FieldDescriptor>) =>
    change({
      ...form,
      fields: form.fields.map((item) => (item.key === field.key ? { ...item, ...patch } : item)),
    });
  const numeric = (
    key: "minLength" | "maxLength" | "minInclusive" | "maxInclusive",
    label: string,
  ) => (
    <div className="fm-field">
      <Label htmlFor={`${field.key}-${key}`}>{label}</Label>
      <Input
        id={`${field.key}-${key}`}
        type="number"
        value={field[key] ?? ""}
        onChange={(event) => {
          const copy = { ...field };
          if (event.target.value === "") delete copy[key];
          else copy[key] = Number(event.target.value);
          change({
            ...form,
            fields: form.fields.map((item) => (item.key === field.key ? copy : item)),
          });
        }}
      />
    </div>
  );
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="fm-card"
      aria-label={`Question ${index + 1}`}
    >
      <div className="fm-toolbar">
        <span className="fm-eyebrow">QUESTION {index + 1}</span>
        <div className="fm-actions">
          <IconButton
            variant="ghost"
            label={`Reorder question ${index + 1}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical />
          </IconButton>
          <IconButton
            variant="ghost"
            label={`Move question ${index + 1} up`}
            disabled={index === 0}
            onClick={() => change(moveQuestion(form, index, index - 1))}
          >
            <ArrowUp />
          </IconButton>
          <IconButton
            variant="ghost"
            label={`Move question ${index + 1} down`}
            disabled={index === form.fields.length - 1}
            onClick={() => change(moveQuestion(form, index, index + 1))}
          >
            <ArrowDown />
          </IconButton>
          <IconButton
            variant="ghost"
            label={`Duplicate question ${index + 1}`}
            onClick={() => change(duplicateQuestion(form, field.key, crypto.randomUUID()))}
          >
            <Copy />
          </IconButton>
          <IconButton
            variant="ghost"
            label={`Delete question ${index + 1}`}
            onClick={() =>
              change({ ...form, fields: form.fields.filter((item) => item.key !== field.key) })
            }
          >
            <Trash2 />
          </IconButton>
        </div>
      </div>
      <div className="fm-field">
        <Label htmlFor={`${field.key}-label`}>Question title</Label>
        <Input
          id={`${field.key}-label`}
          value={field.label ?? ""}
          onChange={(event) => update({ label: event.target.value })}
        />
      </div>
      <div className="fm-pair">
        <div className="fm-field">
          <Label htmlFor={`${field.key}-kind`}>Answer type</Label>
          <Select
            value={field.kind}
            onValueChange={(kind) => {
              const clean = newQuestion(field.key, kind as QuestionKind);
              change({
                ...form,
                fields: form.fields.map((item) =>
                  item.key === field.key
                    ? {
                        ...clean,
                        key: field.key,
                        path: field.path,
                        label: field.label ?? "",
                        description: field.description ?? "",
                        minCount: field.minCount,
                        ...(field.group ? { group: field.group } : {}),
                      }
                    : item,
                ),
              });
            }}
          >
            <SelectTrigger id={`${field.key}-kind`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(questionKinds).map(([kind, label]) => (
                <SelectItem key={kind} value={kind}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="fm-field">
          <Label htmlFor={`${field.key}-group`}>Section</Label>
          <Select
            value={field.group ?? "ungrouped"}
            onValueChange={(group) => {
              const copy = { ...field };
              if (group === "ungrouped") delete copy.group;
              else copy.group = group;
              change({
                ...form,
                fields: form.fields.map((item) => (item.key === field.key ? copy : item)),
              });
            }}
          >
            <SelectTrigger id={`${field.key}-group`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ungrouped">No section</SelectItem>
              {form.groups.map((group) => (
                <SelectItem key={group.iri} value={group.iri}>
                  {group.label || "Untitled section"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="fm-field">
        <Label htmlFor={`${field.key}-help`}>Help text</Label>
        <Input
          id={`${field.key}-help`}
          value={field.description ?? ""}
          onChange={(event) => update({ description: event.target.value })}
        />
      </div>
      {field.kind === "choice" && (
        <div className="fm-field">
          <Label htmlFor={`${field.key}-options`}>Choices (one per line)</Label>
          <Textarea
            id={`${field.key}-options`}
            value={field.options?.map((option) => option.value).join("\n") ?? ""}
            onChange={(event) =>
              update({
                options: event.target.value
                  .split("\n")
                  .map((value) => ({ value, termType: "Literal" })),
              })
            }
          />
        </div>
      )}
      {(field.kind === "text" || field.kind === "multiline") && (
        <div className="fm-pair">
          {numeric("minLength", "Minimum length")}
          {numeric("maxLength", "Maximum length")}
        </div>
      )}
      {(field.kind === "integer" || field.kind === "decimal") && (
        <div className="fm-pair">
          {numeric("minInclusive", "Minimum value")}
          {numeric("maxInclusive", "Maximum value")}
        </div>
      )}
      <div className="fm-actions">
        <Checkbox
          id={`${field.key}-required`}
          checked={field.minCount > 0}
          onCheckedChange={(checked) => update({ minCount: checked === true ? 1 : 0 })}
        />
        <Label htmlFor={`${field.key}-required`}>Required answer</Label>
      </div>
    </article>
  );
}

export function Designer({
  initial,
  onSaved,
  onClose,
}: {
  initial: FormModel;
  onSaved: (form: FormModel) => void;
  onClose: () => void;
}) {
  const { controller } = useForms();
  const [draft, setDraft] = useState(initial);
  const [issues, setIssues] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(0);
  const [status, setStatus] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const change = (form: FormModel) => {
    setDraft({ ...form, fields: form.fields.map((field, order) => ({ ...field, order })) });
    setDirty(true);
    setStatus("Unsaved changes");
    setIssues([]);
  };
  return (
    <>
      <div className="fm-toolbar">
        <div>
          <h2>Design your form</h2>
          <p className="fm-muted">Start a conversation, one question at a time.</p>
        </div>
        <div className="fm-actions">
          <span role="status">{saving ? "Saving…" : status}</span>
          <Button
            variant="outline"
            onClick={() => {
              if (!dirty || window.confirm("Leave without saving your changes?")) onClose();
            }}
          >
            Back to forms
          </Button>
          <Button
            onClick={() => {
              const errors = designerIssues(draft);
              setIssues(errors);
              if (errors.length) return;
              const submitted = draft;
              setSaving((value) => value + 1);
              void controller
                .save(submitted)
                .then(
                  (saved) => {
                    setDraft((current) => {
                      if (current === submitted) {
                        setDirty(false);
                        setStatus("Saved");
                        return saved;
                      }
                      return current;
                    });
                    onSaved(saved);
                    toast.success("Form saved");
                  },
                  () => setStatus("Save failed · Your draft is still here"),
                )
                .finally(() => setSaving((value) => value - 1));
            }}
          >
            Save form
          </Button>
        </div>
      </div>
      {issues.length > 0 && (
        <div role="alert" className="fm-validation">
          {issues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </div>
      )}
      <div className="fm-designer">
        <section className="fm-stack" aria-label="Form designer">
          <div className="fm-card">
            <div className="fm-field">
              <Label htmlFor="form-title">Form title</Label>
              <Input
                id="form-title"
                value={draft.label ?? ""}
                onChange={(event) => change({ ...draft, label: event.target.value })}
              />
            </div>
            <div className="fm-field">
              <Label htmlFor="form-description">Description</Label>
              <Textarea
                id="form-description"
                value={draft.description ?? ""}
                onChange={(event) => change({ ...draft, description: event.target.value })}
              />
            </div>
          </div>
          {draft.groups.map((group, index) => (
            <div className="fm-card" key={group.iri}>
              <Label htmlFor={`group-${index}`}>Section {index + 1}</Label>
              <div className="fm-actions">
                <Input
                  id={`group-${index}`}
                  value={group.label ?? ""}
                  onChange={(event) =>
                    change({
                      ...draft,
                      groups: draft.groups.map((item) =>
                        item.iri === group.iri ? { ...item, label: event.target.value } : item,
                      ),
                    })
                  }
                />
                <IconButton
                  label={`Delete section ${index + 1}`}
                  variant="ghost"
                  onClick={() =>
                    change({
                      ...draft,
                      groups: draft.groups.filter((item) => item.iri !== group.iri),
                      fields: draft.fields.map((field) => {
                        const copy = { ...field };
                        if (copy.group === group.iri) delete copy.group;
                        return copy;
                      }),
                    })
                  }
                >
                  <Trash2 />
                </IconButton>
              </div>
            </div>
          ))}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={({ active, over }) => {
              if (over)
                change(
                  moveQuestion(
                    draft,
                    draft.fields.findIndex((field) => field.key === active.id),
                    draft.fields.findIndex((field) => field.key === over.id),
                  ),
                );
            }}
          >
            <SortableContext
              items={draft.fields.map((field) => field.key)}
              strategy={verticalListSortingStrategy}
            >
              {draft.fields.map((field, index) => (
                <QuestionEditor
                  key={field.key}
                  field={field}
                  form={draft}
                  index={index}
                  change={change}
                />
              ))}
            </SortableContext>
          </DndContext>
          <div className="fm-actions">
            <Button
              variant="outline"
              onClick={() =>
                change({
                  ...draft,
                  fields: [
                    ...draft.fields,
                    { ...newQuestion(crypto.randomUUID()), order: draft.fields.length },
                  ],
                })
              }
            >
              Add question
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                change({
                  ...draft,
                  groups: [
                    ...draft.groups,
                    {
                      iri: `${draft.shape}-section-${crypto.randomUUID()}`,
                      label: "New section",
                      order: draft.groups.length,
                    },
                  ],
                })
              }
            >
              Add section
            </Button>
          </div>
          <p className="fm-muted">
            To reorder with a keyboard, focus a question's grip, press Space, then use the arrow
            keys. Press Space to drop, or Escape to cancel.
          </p>
        </section>
        <aside className="fm-preview" aria-label="Live preview">
          <p className="fm-eyebrow">LIVE PREVIEW</p>
          <AnswerForm form={draft} validate={controller.store.validate} preview />
        </aside>
      </div>
    </>
  );
}
