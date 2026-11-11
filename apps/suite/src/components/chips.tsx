// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { fetchRdf } from "@jeswr/fetch-rdf";
import {
  type ChipRef,
  chipCandidates,
  chipIri,
  chipQuery,
  chipText,
  resolveChip,
  textChips,
} from "@jeswr/suite-sdk/chips";
import { createChipExtension } from "@jeswr/suite-sdk/chips/tiptap";
import type { Search } from "@jeswr/suite-sdk/search";
import { Chip, ChipPicker, Textarea } from "@jeswr/suite-ui";
import { Agent } from "@solid/object";
import {
  type Editor,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { DataFactory } from "n3";
import {
  type ComponentProps,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ContactsModel } from "@/apps/contacts/lib/model";
import { encodeRef } from "@/lib/refs";
import { type PodSession, usePodSessionState } from "@/lib/session/pod-session";
import { useOptionalShellSearchSource } from "@/shell/search/search-context";

export function chipHref(ref: ChipRef): string {
  if (!chipIri(ref.iri)) return ref.iri;
  const document = new URL(ref.iri);
  document.hash = "";
  const encoded = encodeRef(document.href);
  if (ref.kind === "doc") return `/docs/d/${encoded}`;
  if (ref.kind === "note") return `/notes/n/${encoded}`;
  if (ref.kind === "sheet") return `/sheets/s/${encoded}`;
  if (ref.kind === "event") return `/calendar/e/${encoded}`;
  if (ref.kind === "task") return `/tasks/inbox?task=${encodeRef(ref.iri)}`;
  if (ref.kind === "person") return ref.iri;
  if (ref.kind === "file")
    return `/drive/${document.pathname.endsWith("/") ? "f" : "p"}/${encoded}`;
  return ref.iri;
}

export function SuiteChip({ reference }: { reference: ChipRef }) {
  const state = usePodSessionState();
  const transport = state.status === "ready" ? state.session.fetch : undefined;
  const resolve = useMemo(
    () =>
      transport
        ? (ref: ChipRef) =>
            resolveChip(ref.iri, { fetch: transport, label: ref.label, kind: ref.kind })
        : undefined,
    [transport],
  );
  return <Chip reference={reference} resolve={resolve} href={chipHref(reference)} />;
}

function ChipNode({ node }: NodeViewProps) {
  const { iri, kind, label } = node.attrs;
  const reference = useMemo(() => ({ iri, kind, label }) as ChipRef, [iri, kind, label]);
  return (
    <NodeViewWrapper as="span" contentEditable={false}>
      <SuiteChip reference={reference} />
    </NodeViewWrapper>
  );
}
export function suiteChipExtension() {
  return createChipExtension().extend({
    addNodeView() {
      return ReactNodeViewRenderer(ChipNode);
    },
  });
}

const peopleCache = new WeakMap<typeof fetch, { expires: number; value: Promise<ChipRef[]> }>();
async function chipPeople(session: PodSession): Promise<ChipRef[]> {
  let cached = peopleCache.get(session.fetch);
  if (!cached || cached.expires <= Date.now()) {
    const promise = (async () => {
      const people: ChipRef[] = [
        { iri: session.webId, label: session.displayName, kind: "person" },
      ];
      const model = new ContactsModel(session.fetch, session.storageUrl);
      await Promise.allSettled([
        (async () => {
          const book = await model.loadAddressBook();
          const entries = await model.loadPeople(book);
          const contacts = await Promise.allSettled(
            entries.data.slice(0, 100).map(async (entry) => {
              const person = await model.loadContact(entry.id);
              return {
                iri: person.data.webId ?? entry.id,
                label: person.data.name,
                kind: "person",
              } as ChipRef;
            }),
          );
          for (const contact of contacts)
            if (contact.status === "fulfilled") people.push(contact.value);
        })(),
        (async () => {
          const { dataset } = await fetchRdf(session.webId, {
            fetch: session.fetch,
            maxBytes: 256 * 1024,
          });
          const agent = new Agent(session.webId, dataset, DataFactory);
          for (const iri of agent.knows) people.push({ iri, label: iri, kind: "person" });
        })(),
      ]);
      return people;
    })();
    cached = { expires: Date.now() + 30_000, value: promise };
    peopleCache.set(session.fetch, cached);
  }
  return cached.value;
}

export function useChipSearch(session?: PodSession) {
  const source = useOptionalShellSearchSource();
  return useCallback(
    async (query: string, signal: AbortSignal) => {
      const search: Search = async (q) => {
        if (!source) return { source: "local", results: [] };
        const page = await source.search(q.text ?? "", { signal });
        return {
          source: page.source,
          results: page.results.map((item) => ({
            url: item.id,
            title: item.title,
            parent: item.parent ?? "",
            type:
              item.app === "calendar"
                ? "event"
                : item.app === "notes"
                  ? "note"
                  : item.app === "sheets"
                    ? "sheet"
                    : item.type,
          })),
        };
      };
      return chipCandidates(query, {
        search,
        contacts: session ? await chipPeople(session) : [],
        signal,
      });
    },
    [source, session],
  );
}

export function ChipEditorTools({
  editor,
  session,
}: {
  editor: Editor | null;
  session: PodSession;
}) {
  const search = useChipSearch(session);
  const [range, setRange] = useState<{ from: number; to: number; query: string } | null>(null);
  const dismissed = useRef<number | null>(null);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      if (
        !editor.isFocused ||
        !editor.isEditable ||
        !editor.state.selection.empty ||
        editor.isActive("codeBlock") ||
        editor.isActive("code")
      )
        return;
      const { $from } = editor.state.selection;
      const query = chipQuery(
        $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc"),
        $from.parentOffset,
      );
      if (!query) {
        dismissed.current = null;
        return;
      }
      const from = $from.start() + query.from;
      if (dismissed.current !== from) setRange({ ...query, from, to: $from.pos });
    };
    editor.on("update", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("update", update);
      editor.off("selectionUpdate", update);
    };
  }, [editor]);
  if (!range || !editor) return null;
  const close = () => {
    dismissed.current = range.from;
    setRange(null);
    editor.commands.focus();
  };
  return createPortal(
    <div
      style={{ position: "fixed", bottom: "var(--space-4)", left: "var(--space-4)", zIndex: 100 }}
    >
      <ChipPicker
        initialQuery={range.query}
        search={search}
        onClose={close}
        onChoose={(reference) => {
          setRange(null);
          if (!editor.isEditable) return;
          editor
            .chain()
            .focus()
            .insertContentAt({ from: range.from, to: range.to }, [
              { type: "chip", attrs: reference },
              { type: "text", text: " " },
            ])
            .run();
        }}
      />
    </div>,
    document.body,
  );
}

/** Adds mentions without changing a text composer's storage format or save contract. */
export function ChipTextarea({
  value = "",
  onChange,
  onBlur,
  onKeyDown,
  ref: forwardedRef,
  ...props
}: ComponentProps<"textarea">) {
  const state = usePodSessionState();
  const search = useChipSearch(state.status === "ready" ? state.session : undefined);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const [range, setRange] = useState<ReturnType<typeof chipQuery>>(null);
  const current = String(value);
  return (
    <>
      <Textarea
        {...props}
        value={value}
        ref={(node) => {
          field.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        onChange={(event) => {
          onChange?.(event);
          setRange(chipQuery(event.target.value, event.target.selectionStart));
        }}
        onBlur={(event) => {
          if (!range) onBlur?.(event);
        }}
        onKeyDown={onKeyDown}
      />
      {range &&
        createPortal(
          <div
            style={{
              position: "fixed",
              bottom: "var(--space-4)",
              left: "var(--space-4)",
              zIndex: 100,
            }}
          >
            <ChipPicker
              initialQuery={range.query}
              search={search}
              onClose={() => {
                setRange(null);
                field.current?.focus();
              }}
              onChoose={(reference) => {
                const node = field.current;
                if (!node || node.disabled || node.readOnly) {
                  setRange(null);
                  return;
                }
                const next =
                  current.slice(0, range.from) +
                  chipText(reference) +
                  " " +
                  current.slice(range.to);
                // Dispatch through React's native value tracker so the existing controlled field saves normally.
                Object.getOwnPropertyDescriptor(
                  window.HTMLTextAreaElement.prototype,
                  "value",
                )?.set?.call(node, next);
                node.dispatchEvent(new Event("input", { bubbles: true }));
                node.dispatchEvent(new Event("change", { bubbles: true }));
                setRange(null);
                node.focus();
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

export function ChipText({
  text,
  plain = (value: string) => value,
}: {
  text: string;
  plain?: (value: string) => React.ReactNode;
}) {
  const chips = textChips(text);
  let cursor = 0;
  return (
    <>
      {chips.map(({ ref, from, to }) => {
        const before = text.slice(cursor, from);
        cursor = to;
        return (
          <Fragment key={`${from}:${ref.iri}`}>
            {plain(before)}
            <SuiteChip reference={ref} />
          </Fragment>
        );
      })}
      {plain(text.slice(cursor))}
    </>
  );
}
