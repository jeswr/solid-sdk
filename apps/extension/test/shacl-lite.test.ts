// AUTHORED-BY Codex GPT-6
import { Parser, Store } from 'n3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResolutionBudget } from '../src/background/core/class-resolution-budget';
import { compileShaclLite, memberEvidence, SHACL_LIMITS } from '../src/background/core/shacl-lite';

const C = 'https://example.org/C';
const S = 'https://example.org/Shape';
const PREFIX = `@prefix sh: <http://www.w3.org/ns/shacl#> .
 @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
 @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
 @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
 @prefix : <https://example.org/> .`;
const graph = (ttl: string) => new Store(new Parser().parse(PREFIX + ttl));
const budgets: ResolutionBudget[] = [];
function budget() {
  const b = new ResolutionBudget();
  budgets.push(b);
  return b;
}
function validate(shape: string, data = ':focus a :C .', root = false) {
  const b = budget();
  const store = graph(
    root ? shape : `:Shape a sh:NodeShape; sh:property [ sh:path :p; ${shape} ] .`,
  );
  return compileShaclLite({ iri: S, store }, b)(graph(data), C);
}
afterEach(() => {
  for (const b of budgets.splice(0)) b.dispose();
  vi.restoreAllMocks();
});

describe('shacl-lite supported subset', () => {
  it.each([
    ['sh:minCount 1', ':focus :p "yes" .', ''],
    ['sh:maxCount 1', ':focus :p "yes" .', ':focus :p "a", "b" .'],
    ['sh:class :Other', ':focus :p :value . :value a :Other .', ':focus :p :value .'],
    [
      'sh:class :Other, :Third',
      ':focus :p :value . :value a :Other, :Third .',
      ':focus :p :value . :value a :Other .',
    ],
    ['sh:datatype xsd:string', ':focus :p "yes" .', ':focus :p 1 .'],
    ['sh:datatype xsd:string', ':focus :p "yes" .', ':focus :p :value .'],
    ['sh:in ("yes" :value)', ':focus :p "yes", :value .', ':focus :p "no" .'],
    ['sh:hasValue "yes"', ':focus :p "yes", "other" .', ':focus :p "no" .'],
    ['sh:hasValue "yes", :value', ':focus :p "yes", :value .', ':focus :p "yes" .'],
    ['sh:in ("yes"@en)', ':focus :p "yes"@en .', ':focus :p "yes"@fr .'],
    ['sh:in (1)', ':focus :p 1 .', ':focus :p "1" .'],
    ['sh:in ()', '', ':focus :p "anything" .'],
  ])('%s passes and fails', (shape, pass, fail) => {
    expect(validate(shape, `:focus a :C . ${pass}`)).toEqual({
      conforms: true,
      incomplete: false,
      focusNodes: 1,
    });
    expect(validate(shape, `:focus a :C . ${fail}`)).toEqual({
      conforms: false,
      incomplete: false,
      focusNodes: 1,
    });
  });

  it.each([
    ['IRI', ':value', '"literal"'],
    ['BlankNode', '[]', ':value'],
    ['Literal', '"literal"', ':value'],
    ['BlankNodeOrIRI', '[]', '"literal"'],
    ['BlankNodeOrLiteral', '"literal"', ':value'],
    ['IRIOrLiteral', ':value', '[]'],
  ])('nodeKind %s', (kind, pass, fail) => {
    expect(validate(`sh:nodeKind sh:${kind}`, `:focus a :C; :p ${pass} .`).conforms).toBe(true);
    expect(validate(`sh:nodeKind sh:${kind}`, `:focus a :C; :p ${fail} .`).conforms).toBe(false);
  });

  it.each([
    ['string', '"x"', '1'],
    ['boolean', '"true"^^xsd:boolean', '"TRUE"^^xsd:boolean'],
    ['integer', '"-12"^^xsd:integer', '"1.2"^^xsd:integer'],
    ['decimal', '".25"^^xsd:decimal', '"1e2"^^xsd:decimal'],
    ['double', '"1e3"^^xsd:double', '"infinity"^^xsd:double'],
    ['float', '"INF"^^xsd:float', '"+INF"^^xsd:float'],
    ['dateTime', '"2024-02-29T24:00:00Z"^^xsd:dateTime', '"2023-02-29T00:00:00Z"^^xsd:dateTime'],
  ])('datatype %s checks lexical validity', (type, pass, fail) => {
    expect(validate(`sh:datatype xsd:${type}`, `:focus a :C; :p ${pass} .`).conforms).toBe(true);
    expect(validate(`sh:datatype xsd:${type}`, `:focus a :C; :p ${fail} .`).conforms).toBe(false);
  });

  it.each([
    '2024-01-01',
    '0000-01-01T00:00:00',
    '02024-01-01T00:00:00',
    '2024-04-31T00:00:00',
    '1900-02-29T00:00:00',
    '2024-01-01T24:00:01',
    '2024-01-01T24:01:00',
    '2024-01-01T24:00:00.1',
    '2024-01-01T00:00:00+14:01',
    '2024-01-01T00:00:00-14:01',
  ])('rejects ill-typed dateTime %s', (value) => {
    expect(
      validate('sh:datatype xsd:dateTime', `:focus a :C; :p "${value}"^^xsd:dateTime .`).conforms,
    ).toBe(false);
  });
  it.each([
    '2000-02-29T00:00:00',
    '-2024-02-29T00:00:00.01-14:00',
    '2024-01-01T24:00:00.00+14:00',
    '2024-01-01T00:00:00+01:00',
  ])('accepts dateTime %s', (value) => {
    expect(
      validate('sh:datatype xsd:dateTime', `:focus a :C; :p "${value}"^^xsd:dateTime .`).conforms,
    ).toBe(true);
  });

  it('matches language datatypes', () => {
    expect(validate('sh:datatype rdf:langString', ':focus a :C; :p "x"@en .').conforms).toBe(true);
  });

  it.each([
    ['nonPositiveInteger', '0', '1'],
    ['negativeInteger', '-1', '0'],
    ['long', '9223372036854775807', '9223372036854775808'],
    ['int', '2147483647', '2147483648'],
    ['short', '32767', '32768'],
    ['byte', '127', '128'],
    ['nonNegativeInteger', '0', '-1'],
    ['unsignedLong', '18446744073709551615', '18446744073709551616'],
    ['unsignedInt', '4294967295', '4294967296'],
    ['unsignedShort', '65535', '65536'],
    ['unsignedByte', '255', '999'],
    ['positiveInteger', '1', '0'],
    ['date', '2024-02-29', '2023-02-29'],
  ])('datatype %s is incomplete until lexical and range checks are supported', (type, valid, invalid) => {
    const b = budget();
    const v = compileShaclLite(
      { iri: S, store: graph(`:Shape sh:property [ sh:path :p; sh:datatype xsd:${type} ] .`) },
      b,
    );
    for (const value of [valid, invalid, 'nonsense']) {
      const data = graph(`:focus a :C; :p "${value}"^^xsd:${type} .`);
      expect(v(data, C).incomplete).toBe(true);
      expect(memberEvidence(data, C, b, v)).toBe('incomplete');
    }
    expect(v(graph(':focus a :C .'), C).incomplete).toBe(true);
  });

  it('custom datatypes never certify or drop a target from IRI equality alone', () => {
    for (const value of ['"x"^^:custom', '"x"', ':value'])
      expect(validate('sh:datatype :custom', `:focus a :C; :p ${value} .`).incomplete).toBe(true);
  });

  it('supports root constraints, shapes without targetClass and blank focus nodes', () => {
    expect(validate(':Shape sh:nodeKind sh:BlankNode; sh:class :C .', '[] a :C .', true)).toEqual({
      conforms: true,
      incomplete: false,
      focusNodes: 1,
    });
    expect(validate(':Shape sh:hasValue :focus; sh:in (:focus) .', undefined, true).conforms).toBe(
      true,
    );
  });

  it('accepts explicit PropertyShape declarations', () => {
    expect(
      validate(
        ':Shape sh:property [ a sh:PropertyShape; sh:path :p; sh:minCount 1 ] .',
        ':focus a :C; :p "x" .',
        true,
      ).incomplete,
    ).toBe(false);
    expect(
      validate(':Shape sh:property [ a sh:NodeShape; sh:path :p ] .', undefined, true).incomplete,
    ).toBe(true);
  });

  it('selects positive class evidence; targetClass never creates evidence', () => {
    const b = budget();
    const v = compileShaclLite(
      { iri: S, store: graph(':Shape a sh:NodeShape; sh:targetClass :C .') },
      b,
    );
    for (const ttl of [
      '',
      ':focus a :Other .',
      ':C a rdfs:Class .',
      ':focus :p :C .',
      ':Sub rdfs:subClassOf :C . :focus a :Sub .',
    ]) {
      expect(memberEvidence(graph(ttl), C, b, v)).toBe('non-conforming');
      expect(memberEvidence(graph(ttl), C, b)).toBe('non-conforming');
    }
    expect(memberEvidence(graph(':focus a :C .'), C, b, v)).toBe('conforms');
    expect(memberEvidence(graph(':focus a :C .'), C, b)).toBe('conforms');
  });

  it('requires every focus node to validate and deduplicates values across graphs', () => {
    expect(validate('sh:minCount 1', ':one a :C; :p "x" . :two a :C .')).toEqual({
      conforms: false,
      incomplete: false,
      focusNodes: 2,
    });
    expect(
      validate('sh:maxCount 1', ':focus a :C . :g { :focus :p "x" . } :h { :focus :p "x" . }')
        .conforms,
    ).toBe(true);
  });

  it('follows only a single inverse predicate and checks all inverse values', () => {
    const shape =
      ':Shape sh:property [ sh:path [ sh:inversePath :p ]; sh:class :Other; sh:minCount 1 ] .';
    expect(validate(shape, ':focus a :C . :value :p :focus; a :Other .', true).conforms).toBe(true);
    expect(validate(shape, ':focus a :C; :p :value . :value a :Other .', true).conforms).toBe(
      false,
    );
    expect(validate(shape, ':focus a :C . :value :p :focus .', true).conforms).toBe(false);
  });

  it('handles subclass diamonds and cycles without recursion', () => {
    expect(
      validate(
        'sh:class :Parent',
        `:focus a :C; :p :value . :value a :Child .
      :Child rdfs:subClassOf :Left, :Right . :Left rdfs:subClassOf :Parent .
      :Right rdfs:subClassOf :Parent . :Parent rdfs:subClassOf :Child .`,
      ).conforms,
    ).toBe(true);
    expect(validate('sh:class :Other', ':focus a :C; :p "not a resource" .').conforms).toBe(false);
  });

  it('reuses class and path indexes across repeated constraints and focus nodes', () => {
    const shape =
      ':Shape sh:property [ sh:path :p; sh:class :Other ], [ sh:path :p; sh:nodeKind sh:IRI ] .';
    expect(
      validate(
        shape,
        ':a a :C; :p :one, :two . :b a :C; :p :two . :one a :Other . :two a :Other .',
        true,
      ),
    ).toEqual({ conforms: true, incomplete: false, focusNodes: 2 });
    expect(
      validate(
        'sh:class :Parent',
        ':focus a :C; :p :value . :value a _:Child . _:Child rdfs:subClassOf :Parent .',
      ).conforms,
    ).toBe(true);
  });
});

describe('unsupported, malformed and bounded shapes', () => {
  it.each([
    'rdf:first "bad"',
    'rdf:rest rdf:nil',
    'rdf:first "bad"; rdf:rest rdf:nil',
  ])('rejects a polluted rdf:nil terminator (%s), including empty lists', (pollution) => {
    for (const list of ['("yes")', '()']) {
      const b = budget();
      const store = graph(
        `:Shape sh:property [ sh:path :p; sh:in ${list} ] . rdf:nil ${pollution} .`,
      );
      const v = compileShaclLite({ iri: S, store }, b);
      for (const value of ['yes', 'no'])
        expect(memberEvidence(graph(`:focus a :C; :p "${value}" .`), C, b, v)).toBe('incomplete');
    }
  });

  it('checks the work budget while inspecting rdf:nil statements', () => {
    const b = budget();
    const store = graph(':Shape sh:in () . rdf:nil rdf:first "bad" .');
    const reads = store.readQuads;
    let visited = false;
    vi.spyOn(store, 'readQuads').mockImplementation(function* (...args) {
      for (const q of reads.apply(store, args)) {
        if (q.subject.value.endsWith('#nil')) {
          visited = true;
          b.exhaust();
        }
        yield q;
      }
    });
    const v = compileShaclLite({ iri: S, store }, b);
    expect(visited).toBe(true);
    expect(b.truncated).toBe(true);
    expect(v(graph(':focus a :C .'), C).incomplete).toBe(true);
  });

  it.each([
    'sh:sparql []',
    'sh:or ([ sh:class :Other ])',
    'sh:node :Shape',
    'sh:property :Shape',
    'sh:not :Shape',
    'sh:closed true',
    'sh:pattern "x"',
    'sh:qualifiedValueShape :Shape',
    'sh:deactivated true',
    'sh:targetNode :focus',
    'sh:targetSubjectsOf :p',
    'sh:targetObjectsOf :p',
    'sh:flags "i"',
    'sh:unknown true',
    ':custom true',
  ])('ignores unsupported %s but reports incomplete', (constraint) => {
    const result = validate(constraint);
    expect(result).toEqual({ conforms: true, incomplete: true, focusNodes: 1 });
    const b = budget();
    const v = compileShaclLite({ iri: S, store: graph(`:Shape ${constraint} .`) }, b);
    expect(memberEvidence(graph(':focus a :C .'), C, b, v)).toBe('incomplete');
  });

  it.each([
    ':Shape sh:property "bad" .',
    ':Shape sh:property [] .',
    ':Shape sh:property :missing .',
    ':Shape sh:path :p .',
    ':Shape a sh:PropertyShape .',
    ':Other a sh:NodeShape .',
    ':Shape sh:targetClass "bad" .',
    ':Shape sh:minCount 1 .',
    ':Shape sh:maxCount 1 .',
    ':Shape sh:property [ sh:path :p, :q ] .',
    ':Shape sh:property [ sh:path "bad" ] .',
    ':Shape sh:property [ sh:path [] ] .',
    ':Shape sh:property [ sh:path (:p :q) ] .',
    ':Shape sh:property [ sh:path [ sh:alternativePath (:p :q) ] ] .',
    ':Shape sh:property [ sh:path [ sh:inversePath [ sh:inversePath :p ] ] ] .',
    ':Shape sh:property [ sh:path [ sh:inversePath :p, :q ] ] .',
    ':Shape sh:property [ sh:path [ sh:inversePath "bad" ] ] .',
    ':Shape sh:property [ sh:path [ sh:inversePath :p; :other :q ] ] .',
    ':Shape sh:class "bad" .',
    ':Shape sh:datatype "bad" .',
    ':Shape sh:datatype xsd:string, xsd:boolean .',
    ':Shape sh:nodeKind "bad" .',
    ':Shape sh:nodeKind :IRI .',
    ':Shape sh:nodeKind sh:Unknown .',
    ':Shape sh:in "bad" .',
    ':Shape sh:in [ rdf:first "x" ] .',
    ':Shape sh:in [ rdf:first "x", "y"; rdf:rest rdf:nil ] .',
    ':Shape sh:in [ rdf:first "x"; rdf:rest rdf:nil, :other ] .',
    ':Shape sh:in _:loop . _:loop rdf:first "x"; rdf:rest _:loop .',
  ])('malformed or unsupported structure is incomplete (%s)', (shape) => {
    expect(validate(shape, undefined, true).incomplete).toBe(true);
  });
  it.each([
    '-1',
    '"1"',
    '1.5',
    '"no"^^xsd:integer',
    '"9007199254740992"^^xsd:integer',
  ])('malformed count %s', (count) => {
    expect(validate(`sh:minCount ${count}`).incomplete).toBe(true);
    expect(validate(`sh:maxCount ${count}`).incomplete).toBe(true);
  });
  it('accepts nonnegative signed counts and named RDF lists', () => {
    expect(validate('sh:minCount "-0"^^xsd:integer').incomplete).toBe(false);
    expect(
      validate(':Shape sh:in :list . :list rdf:first :focus; rdf:rest rdf:nil .', undefined, true)
        .incomplete,
    ).toBe(false);
  });
  it('supported failures do not erase the unsupported marker', () => {
    expect(validate('sh:minCount 1; sh:node :Shape')).toMatchObject({
      conforms: false,
      incomplete: true,
    });
  });
  it('absent focus evidence is non-conforming even for unsupported shapes', () => {
    const b = budget();
    const v = compileShaclLite({ iri: S, store: graph(':Shape sh:sparql [] .') }, b);
    expect(memberEvidence(graph(''), C, b, v)).toBe('non-conforming');
  });

  it('quoted triple values are outside the RDF 1.1 constraint subset', () => {
    const quoted = '<<( :s :p :o )>>';
    expect(validate(`sh:hasValue ${quoted}`).incomplete).toBe(true);
    expect(
      validate(
        `:Shape sh:in _:list . _:list rdf:first ${quoted}; rdf:rest rdf:nil .`,
        undefined,
        true,
      ).incomplete,
    ).toBe(true);
    expect(validate('sh:nodeKind sh:IRI', `:focus a :C; :p ${quoted} .`).incomplete).toBe(true);
  });
  it('nested/recursive shapes cannot recurse and unrelated shapes never mix', () => {
    expect(
      validate(
        ':Shape sh:property :property . :property sh:path :p; sh:property :property .',
        undefined,
        true,
      ).incomplete,
    ).toBe(true);
    expect(
      validate(':Shape a sh:NodeShape . :Other sh:sparql []; sh:node :Other .', undefined, true)
        .incomplete,
    ).toBe(false);
  });
  it('bounds property count and list length', () => {
    const properties = Array.from(
      { length: SHACL_LIMITS.properties + 1 },
      (_, i) => `:Shape sh:property [ sh:path :p${i} ] .`,
    ).join('\n');
    expect(validate(properties, undefined, true).incomplete).toBe(true);
    expect(
      validate(`sh:in (${Array.from({ length: SHACL_LIMITS.list + 1 }, () => '"x"').join(' ')})`)
        .incomplete,
    ).toBe(true);
  });
  it('checks the deadline in synchronous shape and data traversals', () => {
    const b = budget();
    const store = graph(':Shape sh:property [ sh:path :p; sh:minCount 1 ] .');
    const v = compileShaclLite({ iri: S, store }, b);
    const data = graph(Array.from({ length: 4000 }, (_, i) => `:n${i} a :C; :p "x" .`).join('\n'));
    let checks = 0;
    vi.spyOn(b, 'active').mockImplementation(() => {
      if (++checks === 100) b.exhaust();
      return !b.signal.aborted;
    });
    expect(v(data, C).incomplete).toBe(true);
    expect(checks).toBe(100);
    expect(compileShaclLite({ iri: S, store }, b)(data, C).incomplete).toBe(true);
    expect(() => memberEvidence(data, C, b)).toThrow();
  });
  it('honours cancellation while evaluating and before evidence is collected', () => {
    const b = budget();
    const c = new AbortController();
    const v = compileShaclLite({ iri: S, store: graph(':Shape a sh:NodeShape .') }, b, c.signal);
    c.abort();
    expect(v(graph(':focus a :C .'), C).incomplete).toBe(true);
    expect(() => memberEvidence(graph(''), C, b, undefined, c.signal)).toThrow();
  });
  it('bounds multiplicative validation work without certifying a partial traversal', () => {
    const shape = graph(
      Array.from({ length: 128 }, (_, i) => `:Shape sh:property [ sh:path :p${i} ] .`).join('\n'),
    );
    const data = graph(Array.from({ length: 8000 }, (_, i) => `:n${i} a :C .`).join('\n'));
    const b = budget();
    expect(compileShaclLite({ iri: S, store: shape }, b)(data, C).incomplete).toBe(true);
    expect(b.truncated).toBe(false);
  });
});
