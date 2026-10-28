// AUTHORED-BY Codex
import { flattenExtensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

// Markdown and the live editor must accept the same inline mark combinations.
// Code excludes no marks, so links and visual formatting can surround code.
export const compatibleCodeExtensions = flattenExtensions([StarterKit])
  .filter((extension) => extension.name === "code")
  .map((extension) => extension.extend({ excludes: "" }));
