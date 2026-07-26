/*
 * agent-flow-studio — snapshot.js
 * -----------------------------------------------------------------------------
 * Pure SVG renderer for canvas snapshots. Given a flow (plain data), it builds
 * a self-contained SVG string that redraws the node cards, ports and wires the
 * way styles.css presents them — no DOM, no external fonts, no network.
 *
 * Like engine.js it is a tiny UMD module so the *exact same code* runs in the
 * browser (window.AgentFlowSnapshot, used by the Snapshot toolbar buttons) and
 * in the Node test suite (require('./snapshot.js')). The output is a pure
 * function of the flow, so the tests can assert determinism.
 *
 * The UI downloads this SVG directly, or rasterizes it to PNG via an <img>
 * with a data: URI drawn onto a <canvas> (see app.js) — still fully offline.
 *
 * Author: Dimitres Kisimov. © 2026 — all rights reserved (portfolio review only; see LICENSE).
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    // Node / CommonJS
    module.exports = factory(require('./engine.js'));
  } else {
    // Browser global (engine.js must be loaded first)
    root.AgentFlowSnapshot = factory(root.AgentFlowEngine);
  }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  /* --- Geometry: mirrors app.js / styles.css ----------------------------- */
  var NODE_W = 172;   // .node width
  var PORT_Y0 = 46;   // vertical center of the first port, from node top
  var PORT_DY = 26;   // vertical spacing between ports
  var HEAD_H = 33;    // header row height (padding + divider)
  var PAD = 28;       // whitespace around the drawing
  var CAPTION_H = 30; // room for the flow-name caption above the canvas

  /* --- Colors: copied from the styles.css palette ------------------------ */
  var COLORS = {
    bg: '#0d1117',
    card: '#131a24',
    line: '#26303d',
    text: '#e6edf3',
    muted: '#8b98a9',
    wire: '#5a6b82',
    portFill: '#1b2430',
    types: {
      trigger: '#3fb950',
      agent: '#7c5cff',
      tool: '#4c8dff',
      condition: '#d29922',
      output: '#ec6a5e'
    }
  };
  var FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  var MONO = "Consolas,'Liberation Mono',Menlo,monospace";

  /* --- Small pure helpers ------------------------------------------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function truncate(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /* Same cubic-bezier shape the live canvas uses (app.js wirePath). */
  function wirePath(x1, y1, x2, y2) {
    var dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    return 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ' ' + (x2 - dx) + ' ' + y2 + ' ' + x2 + ' ' + y2;
  }

  /* Card height: enough for header + body, stretched if a node has many ports. */
  function nodeHeight(node) {
    var spec = E.NODE_SPECS[node.type] || { inputs: [], outputs: [] };
    var ports = Math.max(spec.inputs.length, spec.outputs.length);
    var forPorts = ports > 0 ? PORT_Y0 + (ports - 1) * PORT_DY + 18 : 0;
    return Math.max(66, forPorts);
  }

  /* Center of a port on a node whose top-left is (x, y) — mirrors app.js. */
  function portCenter(node, x, y, dir, port) {
    var spec = E.NODE_SPECS[node.type];
    var list = dir === 'out' ? spec.outputs : spec.inputs;
    var idx = list.indexOf(port);
    if (idx < 0) idx = 0;
    return { x: dir === 'out' ? x + NODE_W : x, y: y + PORT_Y0 + idx * PORT_DY };
  }

  /* Plain-text one-liner of the node config (the text version of the card body). */
  function summaryText(node) {
    var c = node.config || {};
    switch (node.type) {
      case 'trigger': return truncate(c.text, 26);
      case 'agent': return 'toolbelt: ' + truncate((c.tools || []).join(', ') || '—', 26);
      case 'tool': return 'tool: ' + (c.tool || '—');
      case 'condition': return truncate('if ' + c.field + ' ' + c.op + (c.op === 'exists' ? '' : ' "' + c.value + '"'), 28);
      case 'output': return 'label: ' + truncate(c.label || 'Result', 22);
      default: return '';
    }
  }

  /* --- The renderer -------------------------------------------------------
   * buildSnapshotSvg(flow) -> { svg, width, height }
   * Deterministic: the same flow always yields the identical SVG string.
   * ----------------------------------------------------------------------- */
  function buildSnapshotSvg(flow) {
    var nodes = (flow && flow.nodes) || [];
    var edges = (flow && flow.edges) || [];
    var name = (flow && flow.name) || 'Untitled flow';

    // Bounding box of all node cards (empty canvas gets a small placeholder).
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function (n) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W);
      maxY = Math.max(maxY, n.y + nodeHeight(n));
    });
    if (!nodes.length) { minX = 0; minY = 0; maxX = 280; maxY = 60; }

    var offX = PAD - minX;
    var offY = PAD + CAPTION_H - minY;
    var width = Math.ceil(maxX - minX + PAD * 2);
    var height = Math.ceil(maxY - minY + PAD * 2 + CAPTION_H);

    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });

    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
      '" viewBox="0 0 ' + width + ' ' + height + '" font-family="' + FONT + '">');
    parts.push('<defs><marker id="snap-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="' + COLORS.wire + '"/></marker></defs>');
    parts.push('<rect width="' + width + '" height="' + height + '" fill="' + COLORS.bg + '"/>');

    // Caption: flow name + app name, like a figure title for Slack/slides.
    parts.push('<text x="' + PAD + '" y="' + (PAD - 6) + '" font-size="14" font-weight="700" fill="' + COLORS.text + '">' +
      esc(name) + '<tspan font-weight="400" fill="' + COLORS.muted + '"> — agent-flow-studio</tspan></text>');

    // Wires first so the cards sit on top of them.
    edges.forEach(function (edge) {
      var from = byId[edge.from.node];
      var to = byId[edge.to.node];
      if (!from || !to) return; // dangling edge — skip, like the live canvas
      var a = portCenter(from, from.x + offX, from.y + offY, 'out', edge.from.port);
      var b = portCenter(to, to.x + offX, to.y + offY, 'in', edge.to.port);
      parts.push('<path class="wire" d="' + wirePath(a.x, a.y, b.x, b.y) +
        '" fill="none" stroke="' + COLORS.wire + '" stroke-width="2.5" marker-end="url(#snap-arrow)"/>');
    });

    // Node cards.
    nodes.forEach(function (node) {
      var spec = E.NODE_SPECS[node.type];
      if (!spec) return;
      var x = node.x + offX;
      var y = node.y + offY;
      var h = nodeHeight(node);
      var accent = COLORS.types[node.type] || COLORS.wire;

      parts.push('<g class="snap-node" data-type="' + esc(node.type) + '">');
      parts.push('<rect x="' + x + '" y="' + y + '" width="' + NODE_W + '" height="' + h +
        '" rx="8" fill="' + COLORS.card + '" stroke="' + COLORS.line + '"/>');
      // Top accent bar (the card's colored border-top).
      parts.push('<path d="M ' + (x + 8) + ' ' + y + ' H ' + (x + NODE_W - 8) +
        ' Q ' + (x + NODE_W) + ' ' + y + ' ' + (x + NODE_W) + ' ' + (y + 8) + ' V ' + (y + 3) +
        ' H ' + x + ' V ' + (y + 8) + ' Q ' + x + ' ' + y + ' ' + (x + 8) + ' ' + y + ' Z" fill="' + accent + '"/>');
      // Header: colored dot + title + divider.
      parts.push('<circle cx="' + (x + 15) + '" cy="' + (y + 17) + '" r="4.5" fill="' + accent + '"/>');
      parts.push('<text x="' + (x + 26) + '" y="' + (y + 21) + '" font-size="13" font-weight="700" fill="' + COLORS.text + '">' +
        esc(spec.label) + '</text>');
      parts.push('<line x1="' + x + '" y1="' + (y + HEAD_H) + '" x2="' + (x + NODE_W) + '" y2="' + (y + HEAD_H) +
        '" stroke="' + COLORS.line + '"/>');
      // Body summary line.
      parts.push('<text x="' + (x + 10) + '" y="' + (y + HEAD_H + 17) + '" font-size="10.5" font-family="' + MONO +
        '" fill="' + COLORS.muted + '">' + esc(summaryText(node)) + '</text>');

      // Ports (+ labels on multi-port sides, i.e. the condition's true/false).
      ['in', 'out'].forEach(function (dir) {
        var list = dir === 'out' ? spec.outputs : spec.inputs;
        list.forEach(function (port) {
          var p = portCenter(node, x, y, dir, port);
          parts.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="6" fill="' + COLORS.portFill +
            '" stroke="' + COLORS.wire + '" stroke-width="2"/>');
          if (list.length > 1) {
            var lx = dir === 'out' ? p.x - 12 : p.x + 12;
            parts.push('<text x="' + lx + '" y="' + (p.y + 3) + '" font-size="9" fill="' + COLORS.muted +
              '" text-anchor="' + (dir === 'out' ? 'end' : 'start') + '">' + esc(port) + '</text>');
          }
        });
      });
      parts.push('</g>');
    });

    if (!nodes.length) {
      parts.push('<text x="' + PAD + '" y="' + (PAD + CAPTION_H + 14) + '" font-size="12" fill="' + COLORS.muted +
        '">(empty canvas)</text>');
    }

    parts.push('</svg>');
    return { svg: parts.join('\n'), width: width, height: height };
  }

  /* ===========================================================================
   * Public API
   * ========================================================================= */
  return {
    buildSnapshotSvg: buildSnapshotSvg
  };
});
