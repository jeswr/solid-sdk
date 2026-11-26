// AUTHORED-BY Codex GPT-6.1-Sol
export interface Catalog {
  readonly [key: string]: string | Catalog;
}
export type PartialCatalog<C> = {
  readonly [K in keyof C]?: C[K] extends string ? string : PartialCatalog<C[K]>;
};
export type MessageKey<C> = {
  [K in keyof C & string]: C[K] extends string ? K : `${K}.${MessageKey<C[K]>}`;
}[keyof C & string];
type ValueAt<C, K extends string> = K extends `${infer A}.${infer B}`
  ? A extends keyof C
    ? ValueAt<C[A], B>
    : never
  : K extends keyof C
    ? C[K]
    : never;
type Trim<S extends string> = S extends ` ${infer R}` | `\n${infer R}` | `\t${infer R}`
  ? Trim<R>
  : S extends `${infer R} ` | `${infer R}\n` | `${infer R}\t`
    ? Trim<R>
    : S;
type Token<
  S extends string,
  Stop extends string,
  A extends string = "",
> = S extends `${infer H}${infer R}`
  ? H extends Stop
    ? [Trim<A>, H, R]
    : Token<R, Stop, `${A}${H}`>
  : [Trim<A>, "", ""];
// Mirrors the runtime grammar: option bodies recurse; their literal text never becomes a parameter.
type Message<S extends string, P = Record<never, never>> = S extends `\\${infer _H}${infer R}`
  ? Message<R, P>
  : S extends `}${infer R}`
    ? [P, R]
    : S extends `{${infer R}`
      ? Argument<R> extends [infer A, infer Tail extends string]
        ? Message<Tail, P & A>
        : never
      : S extends `${infer _H}${infer R}`
        ? Message<R, P>
        : [P, ""];
type Argument<S extends string> =
  Token<S, "," | "}"> extends [infer Name extends string, infer Stop, infer R extends string]
    ? Stop extends "}"
      ? [Record<Name, string | number>, R]
      : Token<R, ","> extends [infer Kind, string, infer Tail extends string]
        ? Options<Tail, Record<Name, Kind extends "plural" ? number : string>>
        : never
    : never;
type Options<S extends string, P> =
  Trim<S> extends `}${infer R}`
    ? [P, R]
    : Token<S, "{"> extends [string, "{", infer Body extends string]
      ? Message<Body> extends [infer A, infer R extends string]
        ? Options<R, P & A>
        : never
      : never;
export type MessageParameters<S extends string> = string extends S
  ? Parameters
  : Message<S> extends [infer P, string]
    ? P
    : never;
export type Translator<C> = <K extends MessageKey<C>>(
  key: K,
  ...args: keyof MessageParameters<ValueAt<C, K> & string> extends never
    ? [params?: Record<string, never>]
    : [params: MessageParameters<ValueAt<C, K> & string>]
) => string;
export type Parameters = Readonly<Record<string, string | number>>;
