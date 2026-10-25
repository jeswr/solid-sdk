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
