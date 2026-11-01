// AUTHORED-BY Codex GPT-6

import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { refuseRedirects } from "@jeswr/guarded-fetch";
import { NS } from "@jeswr/suite-vocab";
import { DataFactory } from "n3";
import { type Category, categoryTree, MoneyDocument, putCategories, V } from "../model";
import { type MoneyClient, storeOf } from "./container";
import { allTransactions, bulkCategorise } from "./ledger";
import { reconcileMutation } from "./mutations";
export async function loadCategories(client: MoneyClient) {
  try {
    const result = await fetchRdf(storeOf(client).resolve("categories.ttl"), {
      fetch: refuseRedirects(client.fetch),
    });
    const upgraded = [...result.dataset].some(
      (q) =>
        q.object.value === `${NS.POD_MONEY}Category` ||
        q.predicate.value === `${NS.POD_MONEY}parent`,
    );
    const categories = new MoneyDocument(result.dataset).categories();
    return { categories, upgraded };
  } catch (error) {
    if (error instanceof RdfFetchError && error.status === 404)
      return { categories: [], upgraded: false };
    throw error;
  }
}
/** Read/validate before touching any shards. Keep unrelated RDF on category saves. */
export async function saveCategories(
  client: MoneyClient,
  change: (categories: Category[]) => readonly Category[],
  createOnly = false,
) {
  const store = storeOf(client);
  const loaded = await store.read("categories.ttl");
  if (createOnly && loaded.exists) return;
  const categories = change(loaded.document.categories());
  categoryTree(categories);
  await writeCategories(client, loaded, categories);
}
async function writeCategories(
  client: MoneyClient,
  loaded: Awaited<ReturnType<ReturnType<typeof storeOf>["read"]>>,
  categories: readonly Category[],
) {
  await reconcileMutation(
    loaded,
    (value) => {
      const current = value.document.categories();
      return (
        current.length === categories.length &&
        categories.every((category) =>
          current.some(
            (saved) =>
              saved.id === category.id &&
              saved.label === category.label &&
              saved.parent === category.parent,
          ),
        )
      );
    },
    async () => {
      for (const old of loaded.document.categories()) {
        for (const predicate of [V.type, V.label, V.parent]) {
          for (const quad of [
            ...loaded.document.dataset.match(
              DataFactory.namedNode(old.id),
              DataFactory.namedNode(predicate),
            ),
          ]) {
            if (predicate !== V.type || quad.object.value === V.categoryClass)
              loaded.document.dataset.delete(quad);
          }
        }
      }
      putCategories(loaded.document, categories);
      await storeOf(client).write(loaded.url, loaded.document, loaded.condition);
    },
    () => storeOf(client).read(loaded.url),
    // Explicit saves also persist the model's in-memory legacy vocabulary migration.
    false,
  );
}
export async function deleteCategory(client: MoneyClient, id: string, replacement?: string) {
  const loaded = await storeOf(client).read("categories.ttl");
  const categories = loaded.document.categories();
  await reconcileMutation(
    categories,
    (current) => !current.some((category) => category.id === id),
    async () => {
      if (
        replacement === id ||
        (replacement !== undefined && !categories.some((c) => c.id === replacement))
      )
        throw new Error("Choose another category");
      const affected = (await allTransactions(client)).filter((row) => row.category === id);
      if (affected.length && !replacement)
        throw new Error("This category is in use. Choose a replacement category.");
      const next = categories
        .filter((c) => c.id !== id)
        .map((c) =>
          c.parent === id ? reparent(c, categories.find((old) => old.id === id)?.parent) : c,
        );
      categoryTree(next);
      if (affected.length)
        await bulkCategorise(
          client,
          affected.map((row) => row.id),
          replacement,
        );
      await writeCategories(client, loaded, next);
    },
    async () => (await storeOf(client).read("categories.ttl")).document.categories(),
  );
}

export function reparent(category: Category, parent: string | undefined): Category {
  const result = { ...category };
  if (parent === undefined) delete result.parent;
  else result.parent = parent;
  return result;
}

/** Deleted or unknown category references remain editable as Uncategorised. */
export function resolveCategory(id: string | undefined, categories: readonly Category[]) {
  return categories.some((category) => category.id === id) ? id : undefined;
}
