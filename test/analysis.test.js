/*
 * agent-flow-studio — analysis.test.js
 * -----------------------------------------------------------------------------
 * Headless tests for the data-dependency / provenance analyzer (analysis.js),
 * using ONLY Node built-ins — same setup as engine.test.js / linter.test.js:
 *
 *     node --test
 *
 * Covers: direct dependencies, transitive ancestor/descendant closures,
 * topological order and stages (parallelizable levels), the critical path,
 * sources/sinks, trigger→output provenance, cycle + self-loop handling,
 * robustness on garbage input, determinism, and — the important tie to the rest
 * of the system — that the analyzer's order agrees with what the engine actually
 * runs, on both shipped example flows.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../engine.js');
const analysis = require('../analysis.js');

const fixturesDir = path.join(__dirname, 'fixtures');
const examplesDir = path.join(__dirname, '..', 'examples');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name + '.json'), 'utf8'));
}

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

function diamondFlow() {
  return {
    name: 'diamond',
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
}

/* --------------------------------------------------------------------------
 * Result shape
 * ------------------------------------------------------------------------ */
test('analyzeFlow returns the documented result shape', () => {
  const r = analysis.analyzeFlow(linearFlow());
  for (const key of ['nodeCount', 'edgeCount', 'acyclic', 'cycleNodes', 'order',
    'sources', 'sinks', 'stages', 'criticalPath', 'depth', 'triggers', 'outputs',
    'provenance', 'nodes']) {
    assert.ok(Object.prototype.hasOwnProperty.call(r, key), 'missing key: ' + key);
  }
  assert.ok(Object.prototype.hasOwnProperty.call(r.provenance, 'byOutput'));
  assert.ok(Object.prototype.hasOwnProperty.call(r.provenance, 'byTrigger'));
});

/* --------------------------------------------------------------------------
 * Direct dependencies + transitive closures
 * ------------------------------------------------------------------------ */
test('direct dependsOn / feeds are the node\'s predecessors / successors', () => {
  const r = analysis.analyzeFlow(linearFlow());
  assert.deepStrictEqual(r.nodes.b.dependsOn, ['a']);
  assert.deepStrictEqual(r.nodes.b.feeds, ['c']);
  assert.deepStrictEqual(r.nodes.a.dependsOn, []);
  assert.deepStrictEqual(r.nodes.c.feeds, []);
  assert.strictEqual(r.nodes.b.indegree, 1);
  assert.strictEqual(r.nodes.b.outdegree, 1);
});

test('ancestors / descendants are the full transitive closure', () => {
  const r = analysis.analyzeFlow(linearFlow());
  assert.deepStrictEqual(r.nodes.c.ancestors, ['a', 'b']);
  assert.deepStrictEqual(r.nodes.a.descendants, ['b', 'c']);
  // A node is never its own ancestor or descendant in a DAG.
  assert.ok(!r.nodes.b.ancestors.includes('b'));
  assert.ok(!r.nodes.b.descendants.includes('b'));
});

/* --------------------------------------------------------------------------
 * Topological order, stages (parallelizable levels), critical path
 * ------------------------------------------------------------------------ */
test('order is the topological order and matches the engine', () => {
  const flow = linearFlow();
  const r = analysis.analyzeFlow(flow);
  assert.deepStrictEqual(r.order, ['a', 'b', 'c']);
  assert.deepStrictEqual(r.order, engine.topoSort(flow));
});

test('a diamond exposes its middle stage as parallelizable', () => {
  const r = analysis.analyzeFlow(diamondFlow());
  // a (level 0), b & c (level 1, independent -> same stage), d (level 2).
  assert.deepStrictEqual(r.stages, [['a'], ['b', 'c'], ['d']]);
  assert.strictEqual(r.nodes.b.level, 1);
  assert.strictEqual(r.nodes.c.level, 1);
  assert.deepStrictEqual(r.nodes.d.dependsOn, ['b', 'c']);
  assert.deepStrictEqual(r.nodes.d.ancestors, ['a', 'b', 'c']);
});

test('critical path is one longest dependency chain and depth is its length', () => {
  const r = analysis.analyzeFlow(diamondFlow());
  assert.strictEqual(r.depth, 3);              // a -> (b|c) -> d
  assert.strictEqual(r.criticalPath.length, 3);
  assert.strictEqual(r.criticalPath[0], 'a');
  assert.strictEqual(r.criticalPath[2], 'd');
  // The middle node is one of the parallel pair; deterministic tie-break picks 'b'.
  assert.deepStrictEqual(r.criticalPath, ['a', 'b', 'd']);

  const lin = analysis.analyzeFlow(linearFlow());
  assert.deepStrictEqual(lin.criticalPath, ['a', 'b', 'c']);
  assert.strictEqual(lin.depth, 3);
});

test('sources have no dependency, sinks feed nothing', () => {
  const r = analysis.analyzeFlow(diamondFlow());
  assert.deepStrictEqual(r.sources, ['a']);
  assert.deepStrictEqual(r.sinks, ['d']);
});

/* --------------------------------------------------------------------------
 * Provenance (trigger <-> output lineage)
 * ------------------------------------------------------------------------ */
test('provenance links every output back to its feeding trigger(s)', () => {
  const r = analysis.analyzeFlow(loadFixture('valid-branching'));
  // Both Condition branches count statically (documented honesty stance):
  // the single trigger feeds both outputs.
  assert.deepStrictEqual(r.provenance.byOutput.o_hi, ['t']);
  assert.deepStrictEqual(r.provenance.byOutput.o_lo, ['t']);
  assert.deepStrictEqual(r.provenance.byTrigger.t, ['o_hi', 'o_lo']);
});

test('provenance flags an output that no trigger can reach', () => {
  // The orphan fixture wires agent a2 -> output o2 with no trigger upstream.
  const r = analysis.analyzeFlow(loadFixture('invalid-orphan'));
  assert.deepStrictEqual(r.provenance.byOutput.o1, ['t']);
  assert.deepStrictEqual(r.provenance.byOutput.o2, [], 'o2 has no feeding trigger');
  assert.deepStrictEqual(r.provenance.byTrigger.t, ['o1']);
  assert.deepStrictEqual(r.sources.sort(), ['a2', 't']);
});

/* --------------------------------------------------------------------------
 * Cycles + self-loops are reported, not thrown
 * ------------------------------------------------------------------------ */
test('a cycle sets acyclic=false and withholds order/stages/critical path', () => {
  const r = analysis.analyzeFlow(loadFixture('invalid-cycle'));
  assert.strictEqual(r.acyclic, false);
  assert.deepStrictEqual(r.cycleNodes, ['a', 'b']);
  assert.strictEqual(r.order, null);
  assert.deepStrictEqual(r.stages, []);
  assert.deepStrictEqual(r.criticalPath, []);
  assert.strictEqual(r.nodes.a.level, null);
  // Direct dependencies are still reported for the acyclic remainder.
  assert.deepStrictEqual(r.nodes.o.dependsOn, ['t']);
});

test('a self-loop is treated as a cycle', () => {
  const r = analysis.analyzeFlow(loadFixture('invalid-bad-wiring'));
  assert.strictEqual(r.acyclic, false);
  assert.ok(r.cycleNodes.includes('a'), 'the self-looping node is on the cycle');
});

/* --------------------------------------------------------------------------
 * Robustness: never throws on garbage
 * ------------------------------------------------------------------------ */
test('analyzeFlow reports, never throws, on malformed flows', () => {
  assert.doesNotThrow(() => analysis.analyzeFlow(null));
  const nul = analysis.analyzeFlow(null);
  assert.strictEqual(nul.nodeCount, 0);
  assert.strictEqual(nul.acyclic, true);
  assert.deepStrictEqual(nul.stages, []);

  const garbage = analysis.analyzeFlow({ nodes: 'nope', edges: {} });
  assert.strictEqual(garbage.nodeCount, 0);
  assert.strictEqual(garbage.edgeCount, 0);

  // A duplicate id is de-duplicated (first wins), not thrown.
  const dup = analysis.analyzeFlow({
    nodes: [{ id: 'a', type: 'trigger' }, { id: 'a', type: 'output' }],
    edges: []
  });
  assert.strictEqual(dup.nodeCount, 1);
  assert.strictEqual(dup.nodes.a.type, 'trigger');
});

/* --------------------------------------------------------------------------
 * Determinism
 * ------------------------------------------------------------------------ */
test('analyzeFlow is deterministic (byte-identical output)', () => {
  const a = analysis.analyzeFlow(diamondFlow());
  const b = analysis.analyzeFlow(diamondFlow());
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
});

/* --------------------------------------------------------------------------
 * Presentation helpers
 * ------------------------------------------------------------------------ */
test('summarize and describe produce stable, non-empty text', () => {
  const r = analysis.analyzeFlow(linearFlow());
  assert.strictEqual(analysis.summarize(r), '3 nodes, 2 edges; 3 stages, critical path 3 nodes deep');
  const lines = analysis.describe(r);
  assert.ok(lines.length > 1);
  assert.ok(lines.some((l) => l.includes('order: a -> b -> c')));
  assert.strictEqual(analysis.summarize(analysis.analyzeFlow({ nodes: [], edges: [] })),
    'empty flow — nothing to analyze');
});

/* --------------------------------------------------------------------------
 * The tie that matters: analyzer agrees with what the engine actually runs
 * ------------------------------------------------------------------------ */
for (const file of fs.readdirSync(examplesDir).filter((f) => f.endsWith('.json'))) {
  test(`example "${file}": analyzer order matches the engine's run order`, () => {
    const flow = engine.deserializeFlow(fs.readFileSync(path.join(examplesDir, file), 'utf8'));
    const r = analysis.analyzeFlow(flow);
    assert.strictEqual(r.acyclic, true);
    assert.deepStrictEqual(r.order, engine.topoSort(flow));
    assert.deepStrictEqual(r.order, engine.runFlow(flow).order);
    // Every dependency of a node appears before it in the run order.
    const pos = {};
    r.order.forEach((id, i) => { pos[id] = i; });
    for (const id of r.order) {
      for (const dep of r.nodes[id].dependsOn) {
        assert.ok(pos[dep] < pos[id], `${dep} must run before ${id}`);
      }
    }
  });
}
