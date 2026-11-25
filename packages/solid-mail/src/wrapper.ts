// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { EntityWrapper, EntityWrapperConstructor } from "@jeswr/model-runtime";
import type { TermWrapper } from "@rdfjs/wrapper";

type OptionalKeys<W> = { [K in keyof W]-?: undefined extends W[K] ? K : never }[keyof W];
type Clearable<W> = { [K in OptionalKeys<W>]: W[K] };
type PublicWrapper<W> = TermWrapper & Omit<W, OptionalKeys<W>> & Clearable<W>;

/** Keep explicit undefined assignments under exactOptionalPropertyTypes; no RDF logic. */
export function publicWrapper<W extends EntityWrapper>(
  Wrapper: new (...args: ConstructorParameters<EntityWrapperConstructor>) => W,
): new (
  ...args: ConstructorParameters<typeof Wrapper>
) => PublicWrapper<W> {
  return Wrapper as new (
    ...args: ConstructorParameters<typeof Wrapper>
  ) => PublicWrapper<W>;
}
