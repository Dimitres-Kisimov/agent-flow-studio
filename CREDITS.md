# Credits

**agent-flow-studio** was designed and built by **Dimitres Kisimov** (© 2026 Dimitres Kisimov, all rights reserved — see LICENSE).

## Dependencies

None. This project is intentionally **zero-dependency**:

- The UI is vanilla HTML/CSS/JavaScript — no framework, no bundler, no CDN.
- The graph engine (`engine.js`) uses only language built-ins.
- The test suite uses only Node's built-in `node:test` and `node:assert`.
- CI installs nothing beyond Node 20 itself.

Everything is inlined and self-contained so the app runs fully offline — either by
double-clicking `index.html` or serving the folder with `python -m http.server`.

## Inspiration

The concept is a deliberately tiny homage to production low-code / agentic
automation platforms, built to understand them from the inside:

- **n8n** — the node-and-wire canvas metaphor and the "trigger → nodes → output"
  execution model.
- **Microsoft Power Automate** — the low-code flow-builder mental model.
- **LangGraph / agent frameworks** — the idea of an agent that reasons over a
  toolbelt and selects a tool to call.

No code, assets, or trademarks from any of the above are used or included here.
The mock reasoning engine, tool library, graph executor, and UI are all original
and written from scratch for this project.

## Fonts & assets

System fonts only (via a standard system font stack). No external fonts, icons,
or images are fetched — the few glyphs used are Unicode characters.
