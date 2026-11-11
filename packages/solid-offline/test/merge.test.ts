// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import { mergeRdf } from '../src/merge.js';

const { namedNode, literal, quad, blankNode } = DataFactory;
const q = (value: string) => quad(namedNode('urn:s'), namedNode('urn:p'), literal(value));
const a = q('a');
const b = q('b');
const c = q('c');

describe('mergeRdf', () => {
  it.each([
    ['unchanged', [a], [a], [a], [a]],
    ['local add', [a], [a, b], [a], [a, b]],
    ['remote add', [a], [a], [a, c], [a, c]],
    ['local remove', [a, b], [a], [a, b], [a]],
    ['remote remove', [a, b], [a, b], [a], [a]],
    ['both add same quad', [a], [a, b], [a, q('b')], [a, b]],
    ['both remove same quad', [a, b], [a], [a], [a]],
    ['independent replacements', [a], [b], [c], [c, b]],
    ['remote removes while local retains', [a], [a], [], []],
    ['local removes while remote retains', [a], [], [a], []],
    ['opposing changes to different quads', [a, b], [a, c], [b], [c]],
    ['duplicates', [], [a, q('a')], [a, q('a')], [a]],
  ] as const)('%s', (_name, base, local, remote, expected) => {
    expect(mergeRdf(base, local, remote)).toEqual(expected);
  });

  it('accepts DatasetCore and single-use iterables and preserves terms', () => {
    const result = mergeRdf(
      new Store([a]),
      new Store([a, b]),
      (function* () {
        yield a;
        yield c;
      })(),
    );
    expect(result).toEqual([a, c, b]);
    expect(result[0]).toBe(a);
    expect(result[2]?.equals(b)).toBe(true);
    expect(mergeRdf([], [b], [])[0]).toBe(b);
  });

  it('compares all four terms, including language, datatype, graph and blank labels', () => {
    const one = quad(
      blankNode('b'),
      namedNode('urn:p'),
      literal('hello', 'en'),
      namedNode('urn:g'),
    );
    const same = quad(
      blankNode('b'),
      namedNode('urn:p'),
      literal('hello', 'en'),
      namedNode('urn:g'),
    );
    const variants = [
      quad(blankNode('other'), one.predicate, one.object, one.graph),
      quad(one.subject, namedNode('urn:other'), one.object, one.graph),
      quad(one.subject, one.predicate, literal('hello', 'fr'), one.graph),
      quad(one.subject, one.predicate, literal('hello'), one.graph),
      quad(one.subject, one.predicate, one.object, namedNode('urn:other')),
    ];
    expect(mergeRdf([one], [], [same, ...variants])).toEqual(variants);
  });
});
