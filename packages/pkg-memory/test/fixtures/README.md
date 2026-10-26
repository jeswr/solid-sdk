<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Five fictional claims, created for MCP-04. All person, agent, document, and entity
IRIs use `example.org`; vocabulary namespaces retain their standard IRIs.

`synthetic.expected.trig` and `synthetic.ids.json` come from the unmodified
reference `np_builder.py` CLI with RDFlib 7.1.4, run by `../generate-fixtures.py`.
Only the five publication-generation timestamps are fixed to
`2026-10-25T12:00:00+00:00` after generation. All identifiers and all other graphs
are reference outputs. Blank-node labels and TriG formatting are not compared;
the complete 223-quad dataset is compared for RDF isomorphism.

The inputs are entirely synthetic, including the worker and source records.
No pilot files, registry, or other pilot dependencies are imported or stubbed.
The deliberate revision and contradiction edges exercise mechanics, not clinical
reasoning. Regenerate with an isolated Python environment containing
`rdflib==7.1.4`:

```sh
python3 ../generate-fixtures.py /path/to/knowledge-graph/pipeline/np_builder.py
```

`canonical.json` adds independent RDFlib oracles for symmetric/disconnected
blank nodes, cycles, language and typed literals, multiline strings and Unicode
ordering. Numeric cases cover exact decimal scale, signed zero, all derived
integer datatypes, floating-point notation and non-finite values, and unchanged
invalid numeric literals. The `typed`, `decimal`, `derived-integers`,
`floating-point` and `invalid-numerics` cases are retained as historical oracle
data and assert typed rejection: their inputs contain noncanonical scalar forms
or datatypes outside the explicit nine-datatype allowlist. Supported scalar
spellings and rejected forms are covered separately in `../scalar.test.ts` and
`../literal-policy.test.ts`. These do not contain person records.

`temporal.json` pins RDFlib 7.1.4 lexical values, assertion IDs, and graphs for
`dateTime`, `date`, `gYear`, and `gYearMonth`. Equivalent inputs cover missing
timezones, UTC spellings, nonzero offsets, fractional microsecond padding and
truncation, zero fractions, and leading year zeroes. Unrepresentable Python
calendar values retain their original spelling. Generate this oracle separately
without regenerating the other fixtures:

```sh
python3 ../generate-temporal-fixtures.py /path/to/knowledge-graph/pipeline/np_builder.py
```

Format the generated JSON with the workspace's Biome formatter before committing.

`literal-parity.json` pins independent RDFlib 7.1.4 IDs, skolemized graphs and
language-tag spelling for uppercase, mixed-case and lowercase tags. Named-subject
and blank-subject assertions exercise both N-Triples hashing and blank-node
labeling. Scalar cases pin accepted stable spellings and Python's treatment of
rejected inputs, including the reviewed `TRUE` boolean and `1E3` decimal.
Acceptance follows the lane's canonical-only policy, including rejection of
invalid values that Python leaves unchanged. String cases use the existing
plain-string contract, since RDF/JS merges plain strings and explicit
`xsd:string`. Generate this fixture without regenerating the existing oracles:

```sh
python3 ../generate-literal-fixtures.py /path/to/knowledge-graph/pipeline/np_builder.py
```
