/*
 * agent-flow-studio — snapshot.test.js
 * -----------------------------------------------------------------------------
 * Headless tests for the pure SVG snapshot renderer (snapshot.js), using ONLY
 * Node built-ins — same setup as engine.test.js:
 *
 *     node --test
 *
 * Covers: well-formedness, one card per node / one wire per edge, XML escaping
 * of user text, determinism, the empty-canvas placeholder, and that both
 * shipped example flows render.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../engine.js');
const snapshot = require('../snapshot.js');

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function sampleFlow() {
  return {
    name: 'sample',
    nodes: [
      { id: 'a', type: 'trigger', x: 40, y: 120, config: { text: 'need a price quote' } },
      { id: 'c', type: 'condition', x: 280, y: 120, config: { field: 'text', op: 'contains', value: 'quote' } },
      { id: 'o', type: 'output', x: 520, y: 60, config: { label: 'Result' } }
    ],
    edges: [
      { id: 'e1', from: { node: 'a', port: 'out' }, to: { node: 'c', port: 'in' } },
      { id: 'e2', from: { node: 'c', port: 'true' }, to: { node: 'o', port: 'in' } }
    ]
  };
}

/* --------------------------------------------------------------------------
 * Structure
 * ------------------------------------------------------------------------ */
test('snapshot is a well-formed standalone SVG with positive dimensions', () => {
  const snap = snapshot.buildSnapshotSvg(sampleFlow());
  assert.ok(snap.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(snap.svg.trim().endsWith('</svg>'));
  assert.ok(snap.width > 0 && snap.height > 0);
  assert.ok(snap.svg.includes('width="' + snap.width + '"'));
  assert.ok(snap.svg.includes('height="' + snap.height + '"'));
});

test('snapshot draws one card per node and one wire per edge', () => {
  const flow = sampleFlow();
  const svg = snapshot.buildSnapshotSvg(flow).svg;
  assert.strictEqual(count(svg, 'class="snap-node"'), flow.nodes.length);
  assert.strictEqual(count(svg, 'class="wire"'), flow.edges.length);
  // The condition's branch ports are labelled so the picture reads like the canvas.
  assert.ok(svg.includes('>true</text>'));
  assert.ok(svg.includes('>false</text>'));
  // The caption names the flow.
  assert.ok(svg.includes('sample'));
});

test('snapshot skips a dangling edge instead of throwing (like the live canvas)', () => {
  const flow = sampleFlow();
  flow.edges.push({ id: 'ghost', from: { node: 'a', port: 'out' }, to: { node: 'nope', port: 'in' } });
  const svg = snapshot.buildSnapshotSvg(flow).svg;
  assert.strictEqual(count(svg, 'class="wire"'), 2);
});

test('empty canvas yields a small placeholder SVG, not an error', () => {
  const snap = snapshot.buildSnapshotSvg({ name: 'blank', nodes: [], edges: [] });
  assert.ok(snap.svg.includes('(empty canvas)'));
  assert.ok(snap.width > 0 && snap.height > 0);
});

/* --------------------------------------------------------------------------
 * Escaping + determinism
 * ------------------------------------------------------------------------ */
test('user text is XML-escaped in the snapshot', () => {
  const flow = sampleFlow();
  flow.name = 'a<b & "c"';
  flow.nodes[0].config.text = '<script>&';
  const svg = snapshot.buildSnapshotSvg(flow).svg;
  assert.ok(!svg.includes('a<b'), 'raw < from user text must not appear');
  assert.ok(!svg.includes('<script>'), 'raw markup from user text must not appear');
  assert.ok(svg.includes('a&lt;b &amp; &quot;c&quot;'));
});

test('snapshot is deterministic — same flow, identical SVG string', () => {
  const a = snapshot.buildSnapshotSvg(sampleFlow());
  const b = snapshot.buildSnapshotSvg(sampleFlow());
  assert.strictEqual(a.svg, b.svg);
  assert.strictEqual(a.width, b.width);
  assert.strictEqual(a.height, b.height);
});

/* --------------------------------------------------------------------------
 * Shipped example flows
 * ------------------------------------------------------------------------ */
const examplesDir = path.join(__dirname, '..', 'examples');

for (const file of fs.readdirSync(examplesDir).filter((f) => f.endsWith('.json'))) {
  test(`example "${file}" renders to a snapshot`, () => {
    const flow = engine.deserializeFlow(fs.readFileSync(path.join(examplesDir, file), 'utf8'));
    const snap = snapshot.buildSnapshotSvg(flow);
    assert.strictEqual(count(snap.svg, 'class="snap-node"'), flow.nodes.length);
    assert.strictEqual(count(snap.svg, 'class="wire"'), flow.edges.length);
  });
}
