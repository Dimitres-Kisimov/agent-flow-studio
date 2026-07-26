/*
 * agent-flow-studio — app.js
 * -----------------------------------------------------------------------------
 * The browser UI: palette drag-and-drop, node movement, port wiring (SVG),
 * selection/delete, the config inspector, and the live run visualization.
 *
 * All graph *logic* lives in engine.js (shared with the Node tests). This file
 * only concerns itself with the DOM and user interaction.
 *
 * Author: Dimitres Kisimov — MIT License, 2026.
 */
(function () {
  'use strict';

  var E = window.AgentFlowEngine;

  /* --- Layout constants (must match styles.css) ------------------------- */
  var NODE_W = 172;
  var PORT_Y0 = 46;   // vertical center of the first port, from node top
  var PORT_DY = 26;   // vertical spacing between ports
  var STORAGE_KEY = 'agent-flow-studio.flow';

  /* --- Application state ------------------------------------------------- */
  var flow = { name: 'Untitled flow', nodes: [], edges: [] };
  var selected = null;          // { kind: 'node'|'edge', id }
  var idCounter = 1;
  var pending = null;           // in-progress connection { fromNode, fromPort }
  var dirty = false;            // edits since the last Save / Load / example

  function markDirty() { dirty = true; }

  /* Ask before an action that replaces the canvas while unsaved edits exist.
   * Save is manual, so Clear/Load/Import used to wipe work with no warning. */
  function confirmDiscard(action) {
    if (!dirty || !flow.nodes.length) return true;
    return window.confirm('You have unsaved changes. ' + action + ' and lose them?');
  }

  /* --- DOM references ---------------------------------------------------- */
  var canvas = document.getElementById('canvas');
  var nodesLayer = document.getElementById('nodes-layer');
  var svg = document.getElementById('wires');
  var tempWire = document.getElementById('temp-wire');
  var emptyHint = document.getElementById('empty-hint');
  var inspectorBody = document.getElementById('inspector-body');
  var traceBody = document.getElementById('trace-body');
  var statusEl = document.getElementById('status');
  var flowNameInput = document.getElementById('flow-name');
  var runInput = document.getElementById('run-input');

  /* Keep the top-bar name field in sync with the model (load/clear/import). */
  function syncFlowNameInput() {
    if (flowNameInput) flowNameInput.value = flow.name || 'Untitled flow';
  }

  /* =====================================================================
   * Palette
   * ===================================================================== */
  function renderPalette() {
    var host = document.getElementById('palette-items');
    host.innerHTML = '';
    Object.keys(E.NODE_SPECS).forEach(function (type) {
      var spec = E.NODE_SPECS[type];
      var el = document.createElement('div');
      el.className = 'palette-item';
      el.style.setProperty('--dot', 'var(--n-' + type + ')');
      el.draggable = true;
      el.innerHTML =
        '<span class="pi-dot"></span>' +
        '<div><div class="pi-label">' + spec.label + '</div>' +
        '<div class="pi-desc">' + spec.description + '</div></div>';
      el.addEventListener('dragstart', function (ev) {
        ev.dataTransfer.setData('text/plain', type);
        ev.dataTransfer.effectAllowed = 'copy';
      });
      host.appendChild(el);
    });
  }

  /* Accept drops from the palette onto the canvas. */
  canvas.addEventListener('dragover', function (ev) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
  canvas.addEventListener('drop', function (ev) {
    ev.preventDefault();
    var type = ev.dataTransfer.getData('text/plain');
    if (!type || !E.NODE_SPECS[type]) return;
    var rect = nodesLayer.getBoundingClientRect();
    var x = ev.clientX - rect.left - NODE_W / 2;
    var y = ev.clientY - rect.top - 20;
    addNode(type, Math.max(0, x), Math.max(0, y));
  });

  /* =====================================================================
   * Model mutations
   * ===================================================================== */
  function newId(prefix) { return prefix + '_' + (idCounter++) + '_' + Math.random().toString(36).slice(2, 6); }

  function addNode(type, x, y) {
    var spec = E.NODE_SPECS[type];
    var node = {
      id: newId('node'),
      type: type,
      x: Math.round(x),
      y: Math.round(y),
      config: JSON.parse(JSON.stringify(spec.defaultConfig))
    };
    flow.nodes.push(node);
    markDirty();
    select('node', node.id);
    renderAll();
    setStatus('Added ' + spec.label + ' node.');
    return node;
  }

  function deleteSelected() {
    if (!selected) return;
    if (selected.kind === 'node') {
      flow.nodes = flow.nodes.filter(function (n) { return n.id !== selected.id; });
      flow.edges = flow.edges.filter(function (e) { return e.from.node !== selected.id && e.to.node !== selected.id; });
    } else if (selected.kind === 'edge') {
      flow.edges = flow.edges.filter(function (e) { return e.id !== selected.id; });
    }
    selected = null;
    markDirty();
    renderInspector();
    renderAll();
    setStatus('Deleted.');
  }

  function addEdge(fromNode, fromPort, toNode, toPort) {
    if (fromNode === toNode) return;
    // Prevent duplicate identical wires.
    var dup = flow.edges.some(function (e) {
      return e.from.node === fromNode && e.from.port === fromPort && e.to.node === toNode && e.to.port === toPort;
    });
    if (dup) { setStatus('Already connected.'); return; }
    // An input port accepts a single wire — replace any existing one.
    var before = flow.edges.length;
    var removed = flow.edges.filter(function (e) { return e.to.node === toNode && e.to.port === toPort; });
    flow.edges = flow.edges.filter(function (e) { return !(e.to.node === toNode && e.to.port === toPort); });
    var replaced = flow.edges.length !== before;
    var edge = { id: newId('edge'), from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } };

    // Reject if it would create a cycle (keep flows acyclic).
    flow.edges.push(edge);
    try {
      E.topoSort(flow);
    } catch (err) {
      flow.edges.pop();
      // Put back any wire we displaced — the connection was rejected.
      flow.edges = flow.edges.concat(removed);
      renderAll();
      setStatus('That connection would create a cycle — not allowed.');
      return;
    }
    markDirty();
    renderAll();
    setStatus(replaced
      ? 'Connected — replaced the wire that was on that input (one wire per input).'
      : 'Connected.');
  }

  /* =====================================================================
   * Selection
   * ===================================================================== */
  function select(kind, id) {
    selected = { kind: kind, id: id };
    renderInspector();
    renderSelectionClasses();
    if (kind === 'edge') setStatus('Wire selected — press Delete to remove it.');
  }
  function clearSelection() {
    selected = null;
    renderInspector();
    renderSelectionClasses();
  }
  function renderSelectionClasses() {
    document.querySelectorAll('.node').forEach(function (el) {
      el.classList.toggle('selected', !!selected && selected.kind === 'node' && el.dataset.id === selected.id);
    });
    document.querySelectorAll('.wire-visible').forEach(function (el) {
      el.classList.toggle('selected', !!selected && selected.kind === 'edge' && el.dataset.id === selected.id);
    });
  }

  /* =====================================================================
   * Rendering — nodes
   * ===================================================================== */
  function nodeById(id) { return flow.nodes.filter(function (n) { return n.id === id; })[0]; }
  function edgeById(id) { return flow.edges.filter(function (e) { return e.id === id; })[0]; }

  function bodySummary(node) {
    var c = node.config || {};
    switch (node.type) {
      case 'trigger': return '<code>' + escapeHtml(truncate(c.text, 60)) + '</code>';
      case 'agent': return 'toolbelt: <code>' + escapeHtml((c.tools || []).join(', ') || '—') + '</code>';
      case 'tool': return 'tool: <code>' + escapeHtml(c.tool || '—') + '</code>';
      case 'condition': return 'if <code>' + escapeHtml(c.field) + ' ' + escapeHtml(c.op) + ' "' + escapeHtml(c.value) + '"</code>';
      case 'output': return 'label: <code>' + escapeHtml(c.label || 'Result') + '</code>';
      default: return '';
    }
  }

  function renderNodes() {
    nodesLayer.innerHTML = '';
    flow.nodes.forEach(function (node) {
      var spec = E.NODE_SPECS[node.type];
      var el = document.createElement('div');
      el.className = 'node';
      el.dataset.id = node.id;
      el.style.left = node.x + 'px';
      el.style.top = node.y + 'px';
      el.style.borderTopColor = 'var(--n-' + node.type + ')';

      el.innerHTML =
        '<div class="node-head">' +
          '<span class="node-icon" style="background:var(--n-' + node.type + ')"></span>' +
          '<span class="node-title">' + spec.label + '</span>' +
        '</div>' +
        '<div class="node-body">' + bodySummary(node) + '</div>';

      // Ports
      spec.inputs.forEach(function (port, i) { el.appendChild(makePort(node, port, 'in', i)); });
      spec.outputs.forEach(function (port, i) { el.appendChild(makePort(node, port, 'out', i)); });

      // Node dragging (grab the card, not a port).
      el.addEventListener('mousedown', function (ev) {
        if (ev.target.classList.contains('port')) return;
        startNodeDrag(node, ev);
      });
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        select('node', node.id);
      });

      nodesLayer.appendChild(el);
    });
    emptyHint.style.display = flow.nodes.length ? 'none' : 'block';
  }

  function makePort(node, port, dir, index) {
    var p = document.createElement('div');
    p.className = 'port ' + dir;
    p.dataset.node = node.id;
    p.dataset.port = port;
    p.dataset.dir = dir;
    p.style.top = (PORT_Y0 + index * PORT_DY - 7) + 'px';
    p.title = dir + ' port: ' + port;

    // Multi-port nodes (condition) get a small label.
    var spec = E.NODE_SPECS[node.type];
    if ((dir === 'out' && spec.outputs.length > 1) || (dir === 'in' && spec.inputs.length > 1)) {
      var lbl = document.createElement('span');
      lbl.className = 'port-label';
      lbl.textContent = port;
      lbl.style.top = (PORT_Y0 + index * PORT_DY - 6) + 'px';
      lbl.style[dir === 'out' ? 'right' : 'left'] = '18px';
      p.appendChild(lbl);
    }

    p.addEventListener('mousedown', function (ev) {
      ev.stopPropagation();
      if (dir === 'out') startConnection(node.id, port, ev);
    });
    p.addEventListener('mouseup', function (ev) {
      if (dir === 'in' && pending) {
        ev.stopPropagation();
        addEdge(pending.fromNode, pending.fromPort, node.id, port);
        endConnection();
      }
    });
    return p;
  }

  /* Center of a port in canvas coordinates. */
  function portCenter(node, dir, port) {
    var spec = E.NODE_SPECS[node.type];
    var list = dir === 'out' ? spec.outputs : spec.inputs;
    var idx = list.indexOf(port);
    if (idx < 0) idx = 0;
    var y = node.y + PORT_Y0 + idx * PORT_DY;
    var x = dir === 'out' ? node.x + NODE_W : node.x;
    return { x: x, y: y };
  }

  /* =====================================================================
   * Rendering — wires
   * ===================================================================== */
  function wirePath(x1, y1, x2, y2) {
    var dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    return 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ' ' + (x2 - dx) + ' ' + y2 + ' ' + x2 + ' ' + y2;
  }

  function renderWires() {
    // Remove previously drawn wires (keep defs + temp wire).
    Array.prototype.slice.call(svg.querySelectorAll('.wire-group')).forEach(function (g) { g.remove(); });

    flow.edges.forEach(function (edge) {
      var from = nodeById(edge.from.node);
      var to = nodeById(edge.to.node);
      if (!from || !to) return;
      var a = portCenter(from, 'out', edge.from.port);
      var b = portCenter(to, 'in', edge.to.port);
      var d = wirePath(a.x, a.y, b.x, b.y);

      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'wire-group');

      // Invisible fat path for easy clicking.
      var hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hit.setAttribute('class', 'wire-hit');
      hit.setAttribute('d', d);
      hit.addEventListener('mousedown', function (ev) { ev.stopPropagation(); select('edge', edge.id); });

      var vis = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      vis.setAttribute('class', 'wire wire-visible');
      vis.setAttribute('d', d);
      vis.dataset.id = edge.id;

      g.appendChild(hit);
      g.appendChild(vis);
      svg.appendChild(g);
    });
    renderSelectionClasses();
  }

  /* =====================================================================
   * Node dragging
   * ===================================================================== */
  function startNodeDrag(node, ev) {
    ev.preventDefault();
    var rect = nodesLayer.getBoundingClientRect();
    var offX = (ev.clientX - rect.left) - node.x;
    var offY = (ev.clientY - rect.top) - node.y;
    var el = nodesLayer.querySelector('.node[data-id="' + node.id + '"]');
    el.classList.add('dragging');
    select('node', node.id);

    function move(e) {
      var r = nodesLayer.getBoundingClientRect();
      node.x = Math.max(0, Math.round((e.clientX - r.left) - offX));
      node.y = Math.max(0, Math.round((e.clientY - r.top) - offY));
      el.style.left = node.x + 'px';
      el.style.top = node.y + 'px';
      markDirty();
      renderWires();
    }
    function up() {
      el.classList.remove('dragging');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  /* =====================================================================
   * Connection dragging (port -> port)
   * ===================================================================== */
  function startConnection(fromNode, fromPort, ev) {
    ev.preventDefault();
    pending = { fromNode: fromNode, fromPort: fromPort };
    var node = nodeById(fromNode);
    var a = portCenter(node, 'out', fromPort);

    function move(e) {
      var r = nodesLayer.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      tempWire.setAttribute('d', wirePath(a.x, a.y, mx, my));
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      // If not dropped on an input port, cancel.
      setTimeout(endConnection, 0);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }
  function endConnection() {
    pending = null;
    tempWire.setAttribute('d', '');
  }

  /* =====================================================================
   * Inspector
   * ===================================================================== */
  function renderInspector() {
    if (selected && selected.kind === 'edge') {
      var edge = edgeById(selected.id);
      if (!edge) { inspectorBody.innerHTML = '<p class="muted">—</p>'; return; }
      var fromN = nodeById(edge.from.node);
      var toN = nodeById(edge.to.node);
      var fromL = fromN && E.NODE_SPECS[fromN.type] ? E.NODE_SPECS[fromN.type].label : '?';
      var toL = toN && E.NODE_SPECS[toN.type] ? E.NODE_SPECS[toN.type].label : '?';
      inspectorBody.innerHTML =
        '<div class="insp-meta">Wire · ' + escapeHtml(edge.id) + '</div>' +
        '<p class="muted">' + escapeHtml(fromL) + ' (' + escapeHtml(edge.from.port) + ') → ' +
        escapeHtml(toL) + ' (' + escapeHtml(edge.to.port) + ')</p>' +
        '<p class="muted">Press <kbd>Delete</kbd> or use the button below to remove it.</p>' +
        '<button class="btn btn-danger" id="cfg-delete">Delete wire</button>';
      document.getElementById('cfg-delete').addEventListener('click', deleteSelected);
      return;
    }
    if (!selected || selected.kind !== 'node') {
      inspectorBody.innerHTML = '<p class="muted">Select a node to edit its configuration.</p>';
      return;
    }
    var node = nodeById(selected.id);
    if (!node) { inspectorBody.innerHTML = '<p class="muted">—</p>'; return; }
    var spec = E.NODE_SPECS[node.type];
    var html = '<div class="insp-meta">' + spec.label + ' · ' + node.id + '</div>';

    switch (node.type) {
      case 'trigger':
        html += field('Initial payload text', '<textarea id="cfg-text">' + escapeHtml(node.config.text) + '</textarea>');
        break;
      case 'agent':
        html += '<div class="insp-field"><label>Toolbelt (click to toggle)</label><div class="chip-row" id="cfg-tools">' +
          E.TOOL_NAMES.map(function (t) {
            var on = (node.config.tools || []).indexOf(t) !== -1;
            return '<span class="chip ' + (on ? 'on' : '') + '" data-tool="' + t + '">' + t + '</span>';
          }).join('') + '</div></div>';
        html += '<p class="muted">The agent scans the payload text and picks the first matching tool from its belt (deterministic rules).</p>';
        break;
      case 'tool':
        html += field('Tool', selectHtml('cfg-tool', E.TOOL_NAMES, node.config.tool));
        break;
      case 'condition':
        html += field('Field', '<input id="cfg-field" type="text" value="' + escapeHtml(node.config.field) + '" />');
        html += field('Operator', selectHtml('cfg-op', ['contains', 'equals', 'not-equals', 'gt', 'lt', 'exists'], node.config.op));
        // "exists" only checks that the field is present — it ignores Value,
        // so hide the field rather than let typing into it do nothing.
        html += '<div class="insp-field" id="cfg-value-field"' + (node.config.op === 'exists' ? ' style="display:none"' : '') + '>' +
          '<label>Value</label><input id="cfg-value" type="text" value="' + escapeHtml(node.config.value) + '" /></div>';
        break;
      case 'output':
        html += field('Label', '<input id="cfg-label" type="text" value="' + escapeHtml(node.config.label || '') + '" />');
        break;
    }
    html += '<button class="btn btn-danger" id="cfg-delete">Delete node</button>';
    inspectorBody.innerHTML = html;
    wireInspector(node);
  }

  function field(label, control) {
    return '<div class="insp-field"><label>' + label + '</label>' + control + '</div>';
  }
  function selectHtml(id, options, value) {
    return '<select id="' + id + '">' + options.map(function (o) {
      return '<option value="' + o + '"' + (o === value ? ' selected' : '') + '>' + o + '</option>';
    }).join('') + '</select>';
  }

  function wireInspector(node) {
    function onChange(id, key, transform) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function () {
        node.config[key] = transform ? transform(el.value) : el.value;
        markDirty();
        refreshNodeBody(node);
      });
    }
    onChange('cfg-text', 'text');
    onChange('cfg-tool', 'tool');
    onChange('cfg-field', 'field');
    onChange('cfg-op', 'op');
    onChange('cfg-value', 'value');
    onChange('cfg-label', 'label');

    // The "exists" operator ignores Value — keep the field hidden while it is
    // selected so nobody types into a control that does nothing.
    var opEl = document.getElementById('cfg-op');
    if (opEl) {
      opEl.addEventListener('input', function () {
        var vf = document.getElementById('cfg-value-field');
        if (vf) vf.style.display = opEl.value === 'exists' ? 'none' : '';
      });
    }

    var toolChips = document.getElementById('cfg-tools');
    if (toolChips) {
      toolChips.addEventListener('click', function (ev) {
        var chip = ev.target.closest('.chip');
        if (!chip) return;
        var t = chip.dataset.tool;
        var arr = node.config.tools || (node.config.tools = []);
        var i = arr.indexOf(t);
        if (i === -1) arr.push(t); else arr.splice(i, 1);
        chip.classList.toggle('on');
        markDirty();
        refreshNodeBody(node);
      });
    }

    var del = document.getElementById('cfg-delete');
    if (del) del.addEventListener('click', deleteSelected);
  }

  function refreshNodeBody(node) {
    var el = nodesLayer.querySelector('.node[data-id="' + node.id + '"] .node-body');
    if (el) el.innerHTML = bodySummary(node);
  }

  /* =====================================================================
   * Running the flow (live visualization)
   * ===================================================================== */
  var runToken = 0;

  function runFlow() {
    if (!flow.nodes.length) { setStatus('Nothing to run — add some nodes first.'); return; }

    // Optional what-if input: overrides every Trigger's payload text for THIS
    // run only, on a copy of the flow — node configs are never touched.
    var testText = runInput ? runInput.value.trim() : '';
    var flowToRun = flow;
    if (testText) {
      flowToRun = JSON.parse(E.serializeFlow(flow));
      flowToRun.nodes.forEach(function (n) {
        if (n.type === 'trigger') n.config.text = testText;
      });
    }

    var result;
    try {
      result = E.runFlow(flowToRun);
    } catch (err) {
      setStatus('Run failed: ' + err.message);
      return;
    }

    // Reset visuals (including any captured-result boxes from the previous run).
    document.querySelectorAll('.node').forEach(function (el) { el.classList.remove('running', 'done', 'skipped'); });
    document.querySelectorAll('.wire-visible').forEach(function (el) { el.classList.remove('active'); });
    document.querySelectorAll('.node-result').forEach(function (el) { el.remove(); });
    traceBody.innerHTML = '';
    setStatus('Running…');

    var token = ++runToken;
    var i = 0;
    // Which edges actually carried data (for highlighting live wires).
    var activeEdges = computeActiveEdges(result);

    function step() {
      if (token !== runToken) return; // a newer run superseded this one
      if (i >= result.trace.length) {
        setStatus('Done — ' + Object.keys(result.outputs).length + ' output(s) captured' +
          (testText ? ' (ran with the test input; Trigger config untouched).' : '.'));
        return;
      }
      var s = result.trace[i++];
      var el = nodesLayer.querySelector('.node[data-id="' + s.nodeId + '"]');

      if (s.status === 'skipped') {
        if (el) el.classList.add('skipped');
        appendTrace(s);
        setTimeout(step, 120);
        return;
      }

      if (el) el.classList.add('running');
      appendTrace(s);
      // Light up the outgoing active wires from this node.
      highlightEdgesFrom(s.nodeId, activeEdges);

      setTimeout(function () {
        if (token !== runToken) return;
        if (el) { el.classList.remove('running'); el.classList.add('done'); }
        // Show the captured payload right on the Output node so the result is
        // visible on the canvas, not only inside the trace panel.
        if (s.type === 'output' && s.status === 'ok') showNodeResult(s.nodeId, s.output);
        step();
      }, 480);
    }
    step();
  }

  /* Attach a small "captured" box to an Output node after a run. */
  function showNodeResult(nodeId, payload) {
    var el = nodesLayer.querySelector('.node[data-id="' + nodeId + '"]');
    if (!el) return;
    var box = el.querySelector('.node-result');
    if (!box) {
      box = document.createElement('div');
      box.className = 'node-result';
      el.appendChild(box);
    }
    box.innerHTML = '<div class="nr-title">captured result</div>' +
      '<pre>' + escapeHtml(JSON.stringify(payload, null, 1)) + '</pre>';
  }

  function computeActiveEdges(result) {
    // An edge is active if its source node ran (not skipped) and, for condition
    // nodes, its port matches the chosen branch.
    var stepByNode = {};
    result.trace.forEach(function (s) { stepByNode[s.nodeId] = s; });
    var active = {};
    flow.edges.forEach(function (e) {
      var s = stepByNode[e.from.node];
      if (!s || s.status === 'skipped') return;
      if (s.type === 'condition') {
        if (e.from.port === s.branch) active[e.id] = true;
      } else {
        active[e.id] = true;
      }
    });
    return active;
  }

  function highlightEdgesFrom(nodeId, activeEdges) {
    flow.edges.forEach(function (e) {
      if (e.from.node !== nodeId || !activeEdges[e.id]) return;
      var el = svg.querySelector('.wire-visible[data-id="' + e.id + '"]');
      if (el) el.classList.add('active');
    });
  }

  function appendTrace(s) {
    var spec = E.NODE_SPECS[s.type];
    var div = document.createElement('div');
    div.className = 'trace-step ' + s.status;
    var badge = '';
    if (s.agentDecision && s.agentDecision.chosenTool) badge = '<span class="ts-badge">→ ' + s.agentDecision.chosenTool + '</span>';
    if (s.type === 'condition' && s.branch) badge = '<span class="ts-badge">' + s.branch + '</span>';
    div.innerHTML =
      '<div class="ts-head"><span class="ts-type">' + (spec ? spec.label : s.type) + badge + '</span>' +
      '<span class="ts-status">' + s.status + '</span></div>' +
      '<div class="ts-detail">' + escapeHtml(s.detail || '') + '</div>' +
      (s.output ? '<pre>' + escapeHtml(JSON.stringify(s.output, null, 2)) + '</pre>' : '');
    traceBody.appendChild(div);
    traceBody.scrollTop = traceBody.scrollHeight;
  }

  /* =====================================================================
   * Persistence: save / load / export / import / examples
   * ===================================================================== */
  function saveLocal() {
    localStorage.setItem(STORAGE_KEY, E.serializeFlow(flow));
    dirty = false;
    setStatus('Saved "' + flow.name + '" to browser storage.');
  }
  function loadLocal() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { setStatus('Nothing saved yet.'); return; }
    if (!confirmDiscard('Load the saved flow')) { setStatus('Load cancelled.'); return; }
    loadFromJson(raw, 'browser storage');
  }
  function exportFlow() {
    var json = E.serializeFlow(flow);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (flow.name || 'flow').replace(/\s+/g, '-').toLowerCase() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Exported ' + a.download + '.');
  }
  function importFlow() {
    if (!confirmDiscard('Import a flow over the canvas')) { setStatus('Import cancelled.'); return; }
    document.getElementById('file-input').click();
  }
  document.getElementById('file-input').addEventListener('change', function (ev) {
    var file = ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { loadFromJson(reader.result, file.name); };
    reader.readAsText(file);
    ev.target.value = '';
  });

  function loadFromJson(raw, sourceLabel) {
    try {
      var loaded = E.deserializeFlow(raw);
      flow = loaded;
      // Keep the id counter ahead of any imported ids to avoid collisions.
      idCounter = flow.nodes.length + flow.edges.length + 1;
      dirty = false;
      syncFlowNameInput();
      clearSelection();
      traceBody.innerHTML = '<p class="muted">Run the flow to see a step-by-step trace here.</p>';
      renderAll();
      setStatus('Loaded "' + flow.name + '" from ' + sourceLabel + '.');
    } catch (err) {
      setStatus('Load failed: ' + err.message);
    }
  }

  function loadExample(path) {
    if (!path) return;
    if (!confirmDiscard('Load the example over the canvas')) { setStatus('Example load cancelled.'); return; }
    fetch(path)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (txt) { loadFromJson(txt, path); })
      .catch(function (err) {
        // Opening index.html via file:// blocks fetch — guide the user.
        setStatus('Could not fetch example (' + err.message + '). Tip: serve with "python -m http.server", or use Import.');
      });
  }

  function clearCanvas() {
    if (!confirmDiscard('Clear the canvas')) { setStatus('Clear cancelled.'); return; }
    flow = { name: 'Untitled flow', nodes: [], edges: [] };
    dirty = false;
    syncFlowNameInput();
    clearSelection();
    traceBody.innerHTML = '<p class="muted">Run the flow to see a step-by-step trace here.</p>';
    renderAll();
    setStatus('Canvas cleared.');
  }

  /* =====================================================================
   * Global wiring
   * ===================================================================== */
  function renderAll() {
    renderNodes();
    renderWires();
  }

  function setStatus(msg) { statusEl.textContent = msg; }

  function truncate(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Click on empty canvas clears selection. */
  canvas.addEventListener('mousedown', function (ev) {
    if (ev.target === canvas || ev.target === nodesLayer || ev.target === svg || ev.target === emptyHint) {
      clearSelection();
    }
  });

  /* Keyboard: Delete removes the selection. */
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && selected) {
      var tag = (ev.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return; // don't hijack typing
      ev.preventDefault();
      deleteSelected();
    }
  });

  /* Toolbar buttons. */
  document.getElementById('btn-run').addEventListener('click', runFlow);
  document.getElementById('btn-clear').addEventListener('click', clearCanvas);
  document.getElementById('btn-save').addEventListener('click', saveLocal);
  document.getElementById('btn-load').addEventListener('click', loadLocal);
  document.getElementById('btn-export').addEventListener('click', exportFlow);
  document.getElementById('btn-import').addEventListener('click', importFlow);
  document.getElementById('example-select').addEventListener('change', function (ev) {
    loadExample(ev.target.value);
    ev.target.value = '';
  });

  /* Flow name field: bound to flow.name (drives the export filename too). */
  if (flowNameInput) {
    flowNameInput.addEventListener('input', function () {
      flow.name = flowNameInput.value.trim() || 'Untitled flow';
      markDirty();
    });
  }

  /* =====================================================================
   * Boot
   * ===================================================================== */
  renderPalette();
  renderAll();

  // Restore the last manual Save if there is one; otherwise seed with a tiny
  // starter flow so the canvas is never intimidatingly blank. (Only the Save
  // button writes this key — edits made after the last Save are not restored,
  // so the status message says exactly that.)
  var saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    loadFromJson(saved, 'your last manual Save');
  } else {
    seedStarter();
  }

  function seedStarter() {
    var t = addNode('trigger', 60, 160);
    var a = addNode('agent', 320, 160);
    var o = addNode('output', 580, 160);
    addEdge(t.id, 'out', a.id, 'in');
    addEdge(a.id, 'out', o.id, 'in');
    clearSelection();
    dirty = false; // the seed is not user work — never guard-prompt over it
    syncFlowNameInput();
    setStatus('Ready. Drag nodes from the left, wire ports, then press Run.');
  }
})();
