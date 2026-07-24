<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

# ◆ agent-flow-studio

### Drag nodes. Wire them up. Run an agent flow — live, in your browser, with zero dependencies.

A minimal, self-contained **visual agent-workflow builder** — a tiny "n8n from the inside." Build a flow on a canvas, wire the ports, and watch a deterministic mock agent walk the graph and pick tools in real time. No API key. No backend. No build step. No npm install.

[![offline · no-deps](https://img.shields.io/badge/offline-no%20dependencies-2ea44f)](#run-in-10-seconds)
[![license MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![low-code · agentic](https://img.shields.io/badge/low--code-agentic-7c5cff)](#what-it-demonstrates)
[![tests · node:test](https://img.shields.io/badge/tests-node%3Atest-3fb950)](test/engine.test.js)
[![build step](https://img.shields.io/badge/build%20step-none-lightgrey)](#run-in-10-seconds)

</div>

> **Positioning.** Low-code agent platforms (n8n, Power Automate) can feel like magic from the outside. The fastest way to prove you *understand* one is to build a small one. `agent-flow-studio` is that proof: a from-scratch node-and-wire canvas with its own graph executor and a rule-based "agent" that reasons over a toolbelt — so the internals are no longer a black box.

---

## Screenshot

<!-- Replace with a real screenshot / GIF of the canvas mid-run. -->
```
┌──────────┬────────────────────────────────────────────┬──────────────────┐
│  Nodes   │   ● Trigger ──▶ ◆ LLM Agent ──▶ ◇ Condition │  Inspector       │
│  ▸ Trigger│                                    ├─true──▶ ▣ Escalate ─▶ ▪   │  · tool: escalate│
│  ▸ Agent  │                                    └─false─▶ ▣ Notify   ─▶ ▪   │                  │
│  ▸ Tool   │                                                              │  Execution trace │
│  ▸ Cond.  │   [ ▶ Run ]  live node highlighting + step-by-step trace →    │  1 Trigger  ok   │
│  ▸ Output │                                                              │  2 Agent → price │
└──────────┴────────────────────────────────────────────┴──────────────────┘
```
> *(Placeholder ASCII mock — drop a real `docs/demo.gif` here once recorded.)*

---

## Run in 10 seconds

**Option A — just open it.** Double-click `index.html`. The canvas, palette, engine,
and starter flow all work offline. *(To load the bundled example flows from the
dropdown, use Option B — browsers block `fetch()` on `file://`. You can still
**Import** an example `.json` manually.)*

**Option B — serve it (recommended, unlocks the example dropdown):**

```bash
python -m http.server 8000
# then open http://localhost:8000
```

**Run the tests (no install needed):**

```bash
node --test        # 16 tests, all green — pure engine logic
```

That's the whole setup. There is no `npm install`, because there are no dependencies.

---

## What you can do

- **Drag** any of five node types from the palette onto the canvas: `Trigger`, `LLM Agent`, `Tool`, `Condition`, `Output`.
- **Wire** them by dragging from an output port (right) to an input port (left) — SVG wires with arrowheads. Cycles are rejected automatically (flows stay DAGs).
- **Move / select / delete** nodes and wires (`Delete` key).
- **Configure** the selected node in the inspector: the trigger's payload text, the agent's toolbelt, the tool name, a condition's predicate, an output's label.
- **Run** the flow: the executor walks the nodes in topological order, highlights each as it runs, lights up the live wires, and streams a **step-by-step execution trace** — including the agent's reasoning and which tool it chose.
- **Save / Load / Export / Import**: persist to `localStorage`, or download/upload the flow as JSON. Two example flows ship in `examples/` and load from the dropdown: **RFQ triage** and **Support-ticket router**.

---

## What it demonstrates

| Theme | In this repo |
| --- | --- |
| **Agentic pattern** | The `LLM Agent` node reasons over a *toolbelt* and deterministically selects a tool by matching the payload — the same "observe → decide → act → narrate" loop real agents run, minus the LLM. See `mockAgentReason` in [`engine.js`](engine.js). |
| **Low-code platform internals** | A palette → canvas → ports → wires → run model, mirroring how n8n / Power Automate actually structure a flow. Building it shows I understand these platforms from the inside, not just as a user. |
| **Graph execution** | A real topological-sort executor (Kahn's algorithm) with cycle detection, branch pruning at `Condition` nodes, and per-port data delivery. |
| **No-dependency front-end engineering** | Interactive drag-and-drop, an SVG wiring overlay, live animation, and JSON persistence — in vanilla JS, zero build step, fully offline. |
| **Shared, tested core** | The engine is a single UMD module used *identically* by the browser and the Node test suite, so the logic that runs in the UI is the logic that's covered by tests and CI. |

---

## How it fits my portfolio

This is the **"I understand the low-code platform from the inside"** piece. It has a
sibling repo, **`agentic-automation-lab`**, which compares *low-code vs full-code*
agents head-to-head. Together they show both sides: when to reach for a low-code
canvas, and what that canvas is really doing under the hood.

**Target role context.** Built with the Würth **"Data & AI — (Agentic) Automation
with Low-code Platforms"** internship in mind — the intersection of agentic AI and
low-code fluency. This project is a compact, hands-on argument for both.

---

## Architecture

```
agent-flow-studio/
├── index.html        # single-page app shell
├── styles.css        # dark, IDE-like theme (no external assets)
├── app.js            # all DOM / interaction: drag, wire, inspect, run, persist
├── engine.js         # PURE graph engine — shared by the browser AND the tests (UMD)
├── examples/
│   ├── rfq-triage.json
│   └── support-ticket-router.json
├── test/
│   └── engine.test.js   # node:test + node:assert, zero deps
└── .github/workflows/ci.yml   # Node 20: run tests + validate example JSON
```

**Design rule:** every piece of graph *logic* lives in `engine.js` and nowhere else.
`app.js` only touches the DOM. That separation is what lets the exact code running in
your browser also run headless in CI.

### Node types

| Node | Ports | What it does |
| --- | --- | --- |
| **Trigger** | out | Emits an initial payload (`{ text }`) into the flow. |
| **LLM Agent** | in → out | Scans the payload, picks a tool from its belt by deterministic rules, runs it, and records its reasoning. |
| **Tool** | in → out | A pure transform: `classify`, `lookup-price`, `escalate`, `search-kb`, `billing-lookup`, `notify`. |
| **Condition** | in → true / false | Evaluates a predicate over the payload and routes down exactly one branch. |
| **Output** | in | Captures the final payload. |

---

## Limitations (honest section)

- **The agent is a mock.** It selects tools with a small deterministic keyword-rule
  table, not a real LLM. That is *by design* — it keeps the demo offline, free, fast,
  and fully testable — but it is **not** genuine natural-language reasoning.
- **Not a production engine.** No retries, timeouts, parallel branches, sub-flows,
  loops, error-handling nodes, secrets, or auth. Flows must be acyclic (DAGs).
- **In-memory & single-user.** State lives in the page and `localStorage`; there is no
  server, no collaboration, no versioning.
- **`file://` caveat.** Opening `index.html` directly works for everything except the
  example-dropdown fetch (browser security). Serve the folder, or use **Import**.
- **Deliberately small surface.** The point is clarity and demonstrable understanding,
  not feature parity with n8n.

---

## About this project — Dimitres Kisimov

I built `agent-flow-studio` from scratch to demonstrate, in one small artifact, the
skills that matter for agentic + low-code automation work:

- **Agentic AI thinking** — modelling an agent as *reason-over-a-toolbelt → act → narrate*, and making that loop visible and inspectable.
- **Low-code platform fluency** — recreating the core n8n / Power Automate flow model (palette, canvas, ports, wires, run) well enough to explain exactly how it works.
- **Algorithms & correctness** — a topological-sort executor with cycle detection and branch pruning, backed by a real test suite.
- **Front-end engineering without a crutch** — drag-and-drop, an SVG wiring layer, live run animation, and JSON persistence in vanilla JS with **zero dependencies and no build step**.
- **Engineering hygiene** — shared/tested core module, CI on GitHub Actions, clean commented code, MIT license, honest limitations.

Author: **Dimitres Kisimov** · MIT License © 2026 · see [`CREDITS.md`](CREDITS.md).
