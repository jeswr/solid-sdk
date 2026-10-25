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
