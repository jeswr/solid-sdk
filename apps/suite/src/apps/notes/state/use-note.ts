// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useCallback } from "react";
import type { NotesStore } from "../lib/model/store";
import { useNotesResource } from "./use-notes";

export function useNote(store: NotesStore, url: string) {
  const load = useCallback(() => store.read(url), [store, url]);
  return useNotesResource(store, load);
}
