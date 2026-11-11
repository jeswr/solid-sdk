// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  type ChipRef,
  chipQuery,
  createChipPeople,
  createChipSearch,
  resolveChip,
  chipHref as sdkChipHref,
} from "@jeswr/suite-sdk/chips";
import { createChipExtension } from "@jeswr/suite-sdk/chips/tiptap";
import { isOwnPodIri, podScopedFetch } from "@jeswr/suite-sdk/pod-scoped-fetch";
import {
  Chip,
  ChipEditorTools as SharedChipEditorTools,
  ChipText as SharedChipText,
  ChipTextarea as SharedChipTextarea,
} from "@jeswr/suite-ui/chips";
import {
  type Editor,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { type ComponentProps, useMemo } from "react";
import { ContactsModel } from "@/apps/contacts/lib/model";
import { encodeRef } from "@/lib/refs";
import { type PodSession, usePodSessionState } from "@/lib/session/pod-session";
import { useOptionalShellSearchSource } from "@/shell/search/search-context";

export const chipHref = (ref: ChipRef) => sdkChipHref(ref, encodeRef);
export function SuiteChip({ reference }: { reference: ChipRef }) {
  const state = usePodSessionState();
  const session = state.status === "ready" ? state.session : undefined;
  const authenticatedFetch = session?.fetch;
  const storageUrl = session?.storageUrl;
  const transport = useMemo(
    () =>
      authenticatedFetch && storageUrl ? podScopedFetch(authenticatedFetch, storageUrl) : undefined,
    [authenticatedFetch, storageUrl],
  );
  const resolve = useMemo(
    () =>
      transport
        ? (ref: ChipRef) =>
            resolveChip(ref.iri, { fetch: transport, label: ref.label, kind: ref.kind })
        : undefined,
    [transport],
  );
  return (
    <Chip
      reference={reference}
      resolve={resolve}
      href={chipHref(reference)}
      resolveOnMount={!!session && isOwnPodIri(reference.iri, session.storageUrl)}
    />
  );
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

export function useChipSearch(session?: PodSession) {
  const source = useOptionalShellSearchSource();
  const people = useMemo(
    () =>
      session
        ? createChipPeople({
            ...session,
            contacts: async () => {
              const model = new ContactsModel(session.fetch, session.storageUrl);
              const entries = await model.loadPeople(await model.loadAddressBook());
              const loaded = await Promise.allSettled(
                entries.data.slice(0, 100).map(async (entry) => {
                  const person = await model.loadContact(entry.id);
                  return {
                    iri: person.data.webId ?? entry.id,
                    label: person.data.name,
                    kind: "person" as const,
                  };
                }),
              );
              return loaded.flatMap((result) =>
                result.status === "fulfilled" ? [result.value] : [],
              );
            },
          })
        : undefined,
    [session],
  );
  return useMemo(() => createChipSearch(source, people), [source, people]);
}
export function ChipTextarea(props: ComponentProps<"textarea">) {
  const state = usePodSessionState();
  const search = useChipSearch(state.status === "ready" ? state.session : undefined);
  return <SharedChipTextarea {...props} search={search} />;
}
export function ChipEditorTools({
  editor,
  session,
}: {
  editor: Editor | null;
  session: PodSession;
}) {
  const search = useChipSearch(session);
  const adapter = useMemo(
    () =>
      editor
        ? {
            query() {
              if (
                !editor.isFocused ||
                !editor.isEditable ||
                !editor.state.selection.empty ||
                editor.isActive("codeBlock") ||
                editor.isActive("code")
              )
                return null;
              const { $from } = editor.state.selection;
              const query = chipQuery(
                $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc"),
                $from.parentOffset,
              );
              return query ? { ...query, from: $from.start() + query.from, to: $from.pos } : null;
            },
            subscribe(update: () => void) {
              editor.on("update", update);
              editor.on("selectionUpdate", update);
              return () => {
                editor.off("update", update);
                editor.off("selectionUpdate", update);
              };
            },
            focus() {
              editor.commands.focus();
            },
            insert(range: { from: number; to: number }, reference: ChipRef) {
              if (editor.isEditable)
                editor
                  .chain()
                  .focus()
                  .insertContentAt(range, [
                    { type: "chip", attrs: reference },
                    { type: "text", text: " " },
                  ])
                  .run();
            },
          }
        : null,
    [editor],
  );
  return <SharedChipEditorTools editor={adapter} search={search} />;
}

export function ChipText({
  text,
  plain,
}: {
  text: string;
  plain?: (value: string) => React.ReactNode;
}) {
  return (
    <SharedChipText
      text={text}
      plain={plain}
      renderChip={(reference) => <SuiteChip reference={reference} />}
    />
  );
}
