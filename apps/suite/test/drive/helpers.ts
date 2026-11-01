// AUTHORED-BY Codex GPT-6.1-Sol
import { Parser, Store } from "n3";
export function turtle(text: string, baseIRI = "https://pod.example/"): Store {
  return new Store(new Parser({ baseIRI }).parse(text));
}
