/*
 * agent-flow-studio — linter.test.js
 * -----------------------------------------------------------------------------
 * Headless tests for the flow-graph linter (linter.js), using ONLY Node
 * built-ins — same setup as engine.test.js / snapshot.test.js:
 *
 *     node --test
 *
 * Covers: the structured-diagnostic shape, each rule the linter can emit
 * (via the labelled fixtures in test/fixtures/), determinism, that the shipped
 * example flows lint clean, and that valid fixtures produce zero diagnostics.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../engine.js');
const linter = require('../linter.js');

const fixturesDir = path.join(__dirname, 'fixtures');
const examplesDir = path.join(__dirname, '..', 'examples');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name + '.json'), 'utf8'));
}
function codesOf(result) {
  return result.diagnostics.map((d) => d.code).sort();
}
function hasCode(result, code) {
  return result.diagnostics.some((d) => d.code === code);
}

/* --------------------------------------------------------------------------
 * Diagnostic shape + counts
 * ------------------------------------------------------------------------ */
test('lintFlow returns the documented result shape', () => {
  const r = linter.lintFlow(loadFixture('valid-linear'));
  for (const key of ['ok', 'errorCount', 'warningCount', 'infoCount', 'diagnostics']) {
    assert.ok(Object.prototype.hasOwnProperty.call(r, key), 'missing key: ' + key);
  }
  assert.ok(Array.isArray(r.diagnostics));
});

test('every diagnostic has severity, a known code, a target and a message', () => {
  const r = linter.lintFlow(loadFixture('invalid-bad-wiring'));
  assert.ok(r.diagnostics.length > 0);
  for (const d of r.diagnostics) {
    assert.ok(['error', 'warning', 'info'].includes(d.severity), 'bad severity: ' + d.severity);
    assert.ok(Object.prototype.hasOwnProperty.call(linter.RULES, d.code), 'unknown code: ' + d.code);
    assert.ok(['flow', 'node', 'edge'].includes(d.target.kind), 'bad target kind');
    assert.strictEqual(typeof d.message, 'string');
    assert.ok(d.message.length > 0);
    // The diagnostic's severity must match its rule's declared severity.
    assert.strictEqual(d.severity, linter.RULES[d.code].severity);
  }
});

test('counts agree with the diagnostics and ok reflects zero errors', () => {
  const r = linter.lintFlow(loadFixture('invalid-missing-start'));
  const errors = r.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = r.diagnostics.filter((d) => d.severity === 'warning').length;
  assert.strictEqual(r.errorCount, errors);
  assert.strictEqual(r.warningCount, warnings);
  assert.strictEqual(r.ok, errors === 0);
});

/* --------------------------------------------------------------------------
 * Valid flows are clean
 * ------------------------------------------------------------------------ */
for (const name of ['valid-linear', 'valid-branching']) {
  test(`valid fixture "${name}" produces zero diagnostics`, () => {
    const r = linter.lintFlow(loadFixture(name));
    assert.deepStrictEqual(r.diagnostics, [], 'expected clean, got: ' + JSON.stringify(codesOf(r)));
    assert.strictEqual(r.ok, true);
  });
}

/* --------------------------------------------------------------------------
 * Each invalid fixture catches exactly its intended class of problem
 * ------------------------------------------------------------------------ */
test('cycle: detects a cycle and reports it as an error', () => {
  const r = linter.lintFlow(loadFixture('invalid-cycle'));
  assert.deepStrictEqual(codesOf(r), ['CYCLE']);
  assert.strictEqual(r.ok, false);
});

test('missing start: no Trigger, an unsatisfied input, an unreachable node', () => {
  const r = linter.lintFlow(loadFixture('invalid-missing-start'));
  assert.deepStrictEqual(codesOf(r), ['NO_TRIGGER', 'UNREACHABLE_NODE', 'UNSATISFIED_INPUT']);
});

test('missing end: no Output, dead-end node, empty toolbelt — all warnings (still runnable)', () => {
  const r = linter.lintFlow(loadFixture('invalid-no-output'));
  assert.deepStrictEqual(codesOf(r), ['DEAD_END', 'EMPTY_TOOLBELT', 'NO_OUTPUT']);
  assert.strictEqual(r.ok, true, 'warnings only — no errors, so the flow still runs');
});

test('orphan: an unsatisfied input and a node unreachable from any Trigger', () => {
  const r = linter.lintFlow(loadFixture('invalid-orphan'));
  assert.deepStrictEqual(codesOf(r), ['UNREACHABLE_NODE', 'UNSATISFIED_INPUT']);
  const unsat = r.diagnostics.find((d) => d.code === 'UNSATISFIED_INPUT');
  assert.strictEqual(unsat.target.id, 'a2');
});

test('bad wiring: dangling target, invalid source port, self-loop', () => {
  const r = linter.lintFlow(loadFixture('invalid-bad-wiring'));
  assert.deepStrictEqual(codesOf(r), ['EDGE_DANGLING_TARGET', 'INVALID_SOURCE_PORT', 'SELF_LOOP']);
  for (const d of r.diagnostics) assert.strictEqual(d.target.kind, 'edge');
});

test('unknown tools: agent tool is a warning, tool-node tool is an error', () => {
  const r = linter.lintFlow(loadFixture('invalid-unknown-tool'));
  assert.deepStrictEqual(codesOf(r), ['UNKNOWN_AGENT_TOOL', 'UNKNOWN_TOOL']);
  assert.strictEqual(r.diagnostics.find((d) => d.code === 'UNKNOWN_AGENT_TOOL').severity, 'warning');
  assert.strictEqual(r.diagnostics.find((d) => d.code === 'UNKNOWN_TOOL').severity, 'error');
});

/* --------------------------------------------------------------------------
 * Robustness: the linter never throws, even on garbage input
 * ------------------------------------------------------------------------ */
test('linter reports, never throws, on malformed flows', () => {
  assert.doesNotThrow(() => linter.lintFlow(null));
  assert.ok(hasCode(linter.lintFlow(null), 'FLOW_NOT_OBJECT'));
  assert.ok(hasCode(linter.lintFlow({ nodes: 'nope', edges: {} }), 'NODES_NOT_ARRAY'));
  assert.ok(hasCode(linter.lintFlow({ nodes: [], edges: [] }), 'EMPTY_FLOW'));
  // Duplicate ids and unknown types are surfaced, not thrown.
  const dup = linter.lintFlow({
    nodes: [{ id: 'a', type: 'trigger' }, { id: 'a', type: 'wormhole' }],
    edges: []
  });
  assert.ok(hasCode(dup, 'DUPLICATE_NODE_ID'));
  assert.ok(hasCode(dup, 'UNKNOWN_NODE_TYPE'));
});

/* --------------------------------------------------------------------------
 * Determinism: same input -> byte-identical diagnostics
 * ------------------------------------------------------------------------ */
test('lintFlow is deterministic (stable order, identical output)', () => {
  const a = linter.lintFlow(loadFixture('invalid-bad-wiring'));
  const b = linter.lintFlow(loadFixture('invalid-bad-wiring'));
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
});

/* --------------------------------------------------------------------------
 * The shipped example flows lint clean (they are the "good" reference)
 * ------------------------------------------------------------------------ */
for (const file of fs.readdirSync(examplesDir).filter((f) => f.endsWith('.json'))) {
  test(`example "${file}" lints clean`, () => {
    const flow = engine.deserializeFlow(fs.readFileSync(path.join(examplesDir, file), 'utf8'));
    const r = linter.lintFlow(flow);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.diagnostics, [], 'example not clean: ' + JSON.stringify(codesOf(r)));
  });
}
