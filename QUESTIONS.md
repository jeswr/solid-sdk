<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MCP-01 scope questions

1. DESIGN §4 gives `search` a `{results:[{id,title,url}]}` response, while MCP-01
   requests renaming the existing tools with aliases and no new tools. Options:
   (a) rename only and preserve existing input/output; (b) change the search response
   now. Conservative choice: (a), including the existing optional `scope`. Later tool
   work can introduce the §4 shape explicitly.
2. DESIGN §2 describes a complete app, while MCP-01 asks for scaffolding and MCP-11
   owns composition. Options: (a) runnable Node/Web handler scaffold returning 501;
   (b) implement health, consent and transport now. Conservative choice: (a).
3. DESIGN §3's byte-read result omits the final URL after redirects. Options:
   (a) resolve relative RDF IRIs against the requested URL; (b) preserve an optional
   final representation `url` on `PodReadResult`. Conservative choice: (b), retaining
   the existing fetch-rdf base-IRI behavior. Backends that do not redirect can omit it.
4. DESIGN §3 omits representation negotiation, while existing readRdf/profile reads
   request RDF and generic reads use the server default. Options: (a) prefer RDF on
   all reads; (b) add an optional `PodReadOptions.accept`. Conservative choice: (b),
   preserving both existing behaviors without changing one-argument PodPort backends.
