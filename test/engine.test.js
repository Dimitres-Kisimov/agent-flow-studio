/*
 * agent-flow-studio — engine.test.js
 * -----------------------------------------------------------------------------
 * Headless tests for the pure graph engine, using ONLY Node built-ins
 * (node:test + node:assert). No dependencies, no build step:
 *
 *     node --test
 *
 * Covers: topological execution order, the mock agent's tool selection,
 * full-flow execution + branching, JSON round-trip, validation, and that the
 * shipped example flows are valid and run end-to-end.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../engine.js');

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */
function linearFlow() {
  return {
    name: 'linear',
    nodes: [
      { id: 'a', type: 'trigger', config: { text: 'need a price quote' } },
      { id: 'b', type: 'agent', config: { tools: ['lookup-price', 'classify'] } },
      { id: 'c', type: 'output', config: { label: 'end' } }
    ],
    edges: [
      { id: 'e1', from: { node: 'a', port: 'out' }, to: { node: 'b', port: 'in' } },
      { id: 'e2', from: { node: 'b', port: 'out' }, to: { node: 'c', port: 'in' } }
    ]
  };
}

/* --------------------------------------------------------------------------
 * Topological order
 * ------------------------------------------------------------------------ */
test('topoSort orders dependencies before dependents', () => {
  const order = engine.topoSort(linearFlow());
  assert.deepStrictEqual(order, ['a', 'b', 'c']);
});

test('topoSort is deterministic for a diamond graph', () => {
  const flow = {
    nodes: [
      { id: 'a', type: 'trigger', config: {} },
      { id: 'b', type: 'tool', config: { tool: 'classify' } },
      { id: 'c', type: 'tool', config: { tool: 'escalate' } },
      { id: 'd', type: 'output', config: {} }
    ],
    edges: [
      { id: '1', from: { node: 'a', port: 'out' }, to: { node: 'b', port: 'in' } },
      { id: '2', from: { node: 'a', port: 'out' }, to: { node: 'c', port: 'in' } },
      { id: '3', from: { node: 'b', port: 'out' }, to: { node: 'd', port: 'in' } },
      { id: '4', from: { node: 'c', port: 'out' }, to: { node: 'd', port: 'in' } }
    ]
  };
  // 'a' first, 'd' last; b/c sorted deterministically between.
  assert.deepStrictEqual(engine.topoSort(flow), ['a', 'b', 'c', 'd']);
});

test('topoSort throws on a cycle', () => {
  const flow = {
    nodes: [
      { id: 'a', type: 'tool', config: {} },
      { id: 'b', type: 'tool', config: {} }
    ],
    edges: [
      { id: '1', from: { node: 'a', port: 'out' }, to: { node: 'b', port: 'in' } },
      { id: '2', from: { node: 'b', port: 'out' }, to: { node: 'a', port: 'in' } }
    ]
  };
  assert.throws(() => engine.topoSort(flow), /cycle/i);
});

/* --------------------------------------------------------------------------
 * Mock agent tool selection
 * ------------------------------------------------------------------------ */
test('agent picks lookup-price when the text mentions a quote', () => {
  const d = engine.mockAgentReason({ text: 'Please send a price quote' }, ['lookup-price', 'classify']);
  assert.strictEqual(d.chosenTool, 'lookup-price');
  assert.strictEqual(d.matched, 'price');
});

test('agent picks escalate for urgent text', () => {
  const d = engine.mockAgentReason({ text: 'This is URGENT, the line is down' }, ['escalate', 'search-kb']);
  assert.strictEqual(d.chosenTool, 'escalate');
});

test('agent respects its allowed toolbelt (skips disallowed matches)', () => {
  // Text matches lookup-price, but the agent is not allowed to use it.
  const d = engine.mockAgentReason({ text: 'price quote please' }, ['classify']);
  assert.strictEqual(d.chosenTool, 'classify'); // falls back to first allowed
  assert.strictEqual(d.matched, null);
});

test('agent falls back gracefully with no tools', () => {
  const d = engine.mockAgentReason({ text: 'hello' }, []);
  assert.strictEqual(d.chosenTool, null);
});

test('agent reasoning is deterministic', () => {
  const a = engine.mockAgentReason({ text: 'refund my invoice' }, ['billing-lookup', 'escalate']);
  const b = engine.mockAgentReason({ text: 'refund my invoice' }, ['billing-lookup', 'escalate']);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.chosenTool, 'billing-lookup');
});

/* --------------------------------------------------------------------------
 * Tool purity
 * ------------------------------------------------------------------------ */
test('tools do not mutate their input', () => {
  const input = { text: 'order 250 bolts' };
  const out = engine.TOOLS['lookup-price'](input);
  assert.strictEqual(input.quote, undefined, 'input must be untouched');
  assert.strictEqual(out.quantity, 250);
  assert.strictEqual(out.quote, engine.TOOLS['lookup-price']({ text: 'order 250 bolts' }).quote);
});

/* --------------------------------------------------------------------------
 * Full flow execution + branching
 * ------------------------------------------------------------------------ */
test('runFlow executes a linear flow and captures output', () => {
  const result = engine.runFlow(linearFlow());
  assert.deepStrictEqual(result.order, ['a', 'b', 'c']);
  const outKey = Object.keys(result.outputs)[0];
  assert.strictEqual(result.outputs[outKey].label, 'end');
  // Agent should have chosen lookup-price (text mentions "price"/"quote").
  assert.ok(result.outputs[outKey].payload.quote > 0);
});

test('condition node prunes the false branch', () => {
  const flow = {
    nodes: [
      { id: 'a', type: 'trigger', config: { text: 'this is urgent' } },
      { id: 'c', type: 'condition', config: { field: 'text', op: 'contains', value: 'urgent' } },
      { id: 'yes', type: 'output', config: { label: 'YES' } },
      { id: 'no', type: 'output', config: { label: 'NO' } }
    ],
    edges: [
      { id: '1', from: { node: 'a', port: 'out' }, to: { node: 'c', port: 'in' } },
      { id: '2', from: { node: 'c', port: 'true' }, to: { node: 'yes', port: 'in' } },
      { id: '3', from: { node: 'c', port: 'false' }, to: { node: 'no', port: 'in' } }
    ]
  };
  const result = engine.runFlow(flow);
  assert.ok(result.outputs.yes, 'true branch should be captured');
  assert.ok(!result.outputs.no, 'false branch should be pruned');
  const noStep = result.trace.find((s) => s.nodeId === 'no');
  assert.strictEqual(noStep.status, 'skipped');
});

/* --------------------------------------------------------------------------
 * JSON round-trip + validation
 * ------------------------------------------------------------------------ */
test('serialize -> deserialize is a faithful round-trip', () => {
  const flow = engine.deserializeFlow(engine.serializeFlow(linearFlow()));
  assert.strictEqual(flow.nodes.length, 3);
  assert.strictEqual(flow.edges.length, 2);
  assert.strictEqual(flow.nodes[0].type, 'trigger');
  // Running the round-tripped flow yields the same order.
  assert.deepStrictEqual(engine.runFlow(flow).order, ['a', 'b', 'c']);
});

test('deserialize rejects an unknown node type', () => {
  const bad = JSON.stringify({ nodes: [{ id: 'x', type: 'wormhole' }], edges: [] });
  assert.throws(() => engine.deserializeFlow(bad), /Unknown node type/);
});

test('deserialize rejects an edge to a missing node', () => {
  const bad = JSON.stringify({
    nodes: [{ id: 'a', type: 'trigger' }],
    edges: [{ id: 'e', from: { node: 'a', port: 'out' }, to: { node: 'ghost', port: 'in' } }]
  });
  assert.throws(() => engine.deserializeFlow(bad), /missing node/);
});

/* --------------------------------------------------------------------------
 * Undo/redo history (the stack behind the UI's Ctrl+Z)
 * ------------------------------------------------------------------------ */
test('history: undo returns the pre-change state, redo returns the undone one', () => {
  const h = engine.createHistory(10);
  h.push('v1');          // state was "v1" before the change to "v2"
  assert.strictEqual(h.canUndo(), true);
  assert.strictEqual(h.undo('v2'), 'v1');
  assert.strictEqual(h.canRedo(), true);
  assert.strictEqual(h.redo('v1'), 'v2');
  assert.strictEqual(h.canRedo(), false);
});

test('history: a new change invalidates the redo stack', () => {
  const h = engine.createHistory(10);
  h.push('v1');
  h.undo('v2');          // back at v1, redo holds v2
  h.push('v1');          // new change made from v1
  assert.strictEqual(h.canRedo(), false, 'redo must be cleared by a new push');
  assert.strictEqual(h.undo('v3'), 'v1');
});

test('history: depth is bounded — the oldest snapshot is dropped', () => {
  const h = engine.createHistory(3);
  ['a', 'b', 'c', 'd'].forEach((s) => h.push(s));
  assert.strictEqual(h.undo('e'), 'd');
  assert.strictEqual(h.undo('d'), 'c');
  assert.strictEqual(h.undo('c'), 'b');
  assert.strictEqual(h.undo('b'), null, '"a" was trimmed by the limit');
});

test('history: undo/redo on empty stacks return null; clear empties both', () => {
  const h = engine.createHistory(5);
  assert.strictEqual(h.undo('x'), null);
  assert.strictEqual(h.redo('x'), null);
  h.push('v1');
  h.undo('v2');
  h.clear();
  assert.strictEqual(h.canUndo(), false);
  assert.strictEqual(h.canRedo(), false);
});

test('history: serialized flows survive an undo round-trip intact', () => {
  const h = engine.createHistory(10);
  const before = engine.serializeFlow(linearFlow());
  h.push(before);
  const mutated = linearFlow();
  mutated.nodes.pop(); // "the user deleted a node"
  const restored = engine.deserializeFlow(h.undo(engine.serializeFlow(mutated)));
  assert.strictEqual(restored.nodes.length, 3);
  assert.deepStrictEqual(engine.runFlow(restored).order, ['a', 'b', 'c']);
});

/* --------------------------------------------------------------------------
 * Shipped example flows
 * ------------------------------------------------------------------------ */
const examplesDir = path.join(__dirname, '..', 'examples');

for (const file of fs.readdirSync(examplesDir).filter((f) => f.endsWith('.json'))) {
  test(`example "${file}" is valid and runs end-to-end`, () => {
    const raw = fs.readFileSync(path.join(examplesDir, file), 'utf8');
    const flow = engine.deserializeFlow(raw); // throws if invalid
    const result = engine.runFlow(flow);
    assert.ok(result.trace.length > 0, 'flow should produce a trace');
    assert.ok(Object.keys(result.outputs).length > 0, 'flow should reach an Output node');
  });
}
