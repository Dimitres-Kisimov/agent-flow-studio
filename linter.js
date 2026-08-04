/*
 * agent-flow-studio — linter.js
 * -----------------------------------------------------------------------------
 * A pure, dependency-free flow-graph linter. Given a flow (the same plain
 * {name, nodes, edges} data model the engine and UI already use), it returns a
 * list of STRUCTURED diagnostics — each with a severity, a stable rule code, the
 * node/edge/flow it concerns, and a human-readable message.
 *
 * This is deliberately a superset of engine.js's `validateFlow`, which is a
 * hard, import-time gate that THROWS on the handful of problems that make a flow
 * unloadable (bad ids, edges to missing nodes, cycles). The linter never throws:
 * it reports the same structural problems AND the softer, graph-shaped ones a
 * builder cares about but the engine tolerates at run time — nodes that can
 * never receive input, nodes unreachable from any Trigger, a missing Trigger or
 * Output, dead-end nodes whose work is discarded, edges wired to ports that do
 * not exist, empty agent toolbelts, and unknown tools.
 *
 * Honesty note: this catches STRUCTURAL / wiring problems that are decidable
 * from the graph and the node specs alone. It does NOT prove a flow is correct,
 * does not reason about payload contents, and does not follow the data-dependent
 * branch a Condition will take at run time (both branches are treated as
 * statically reachable). Every rule maps to something the engine actually does.
 *
 * Like engine.js and snapshot.js it is a tiny UMD module so the EXACT same code
 * runs in the browser (window.AgentFlowLinter, used by the Lint button) and in
 * the Node test suite (require('./linter.js')). Output is a pure, deterministic
 * function of the input flow — the diagnostics are sorted into a stable order so
 * a re-run is byte-identical.
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
    root.AgentFlowLinter = factory(root.AgentFlowEngine);
  }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  var NODE_SPECS = E.NODE_SPECS;      // source of truth for types + ports
  var TOOLS = E.TOOLS;                 // source of truth for tool names

  var SEVERITY = { ERROR: 'error', WARNING: 'warning', INFO: 'info' };
  var SEV_RANK = { error: 0, warning: 1, info: 2 };

  /* Catalog of every rule the linter can emit, so the docs/tests can reference
   * codes by name and the report can print stable, sorted output. */
  var RULES = {
    FLOW_NOT_OBJECT:       { severity: 'error',   summary: 'Flow is not an object.' },
    NODES_NOT_ARRAY:       { severity: 'error',   summary: 'Flow.nodes is not an array.' },
    EDGES_NOT_ARRAY:       { severity: 'error',   summary: 'Flow.edges is not an array.' },
    EMPTY_FLOW:            { severity: 'warning', summary: 'Flow has no nodes.' },
    NODE_MISSING_ID:       { severity: 'error',   summary: 'A node is missing an id.' },
    DUPLICATE_NODE_ID:     { severity: 'error',   summary: 'Two nodes share an id.' },
    UNKNOWN_NODE_TYPE:     { severity: 'error',   summary: 'Node has a type the engine does not know.' },
    EDGE_MISSING_ID:       { severity: 'warning', summary: 'An edge is missing an id.' },
    DUPLICATE_EDGE_ID:     { severity: 'warning', summary: 'Two edges share an id.' },
    EDGE_MALFORMED:        { severity: 'error',   summary: 'Edge is missing a from/to endpoint.' },
    EDGE_DANGLING_SOURCE:  { severity: 'error',   summary: 'Edge starts at a node that does not exist.' },
    EDGE_DANGLING_TARGET:  { severity: 'error',   summary: 'Edge ends at a node that does not exist.' },
    INVALID_SOURCE_PORT:   { severity: 'error',   summary: 'Edge leaves an output port the node does not have.' },
    INVALID_TARGET_PORT:   { severity: 'error',   summary: 'Edge enters an input port the node does not have.' },
    SELF_LOOP:             { severity: 'error',   summary: 'Edge connects a node to itself.' },
    CYCLE:                 { severity: 'error',   summary: 'Flow contains a cycle (must be acyclic).' },
    NO_TRIGGER:            { severity: 'error',   summary: 'Flow has no Trigger — nothing can start it.' },
    NO_OUTPUT:             { severity: 'warning', summary: 'Flow has no Output — no result is captured.' },
    UNSATISFIED_INPUT:     { severity: 'error',   summary: 'Node has no incoming edge to feed its input.' },
    UNREACHABLE_NODE:      { severity: 'warning', summary: 'Node is not reachable from any Trigger.' },
    DEAD_END:              { severity: 'warning', summary: 'Node output is not wired anywhere — its work is discarded.' },
    EMPTY_TOOLBELT:        { severity: 'warning', summary: 'Agent has no tools — it can only respond directly.' },
    UNKNOWN_AGENT_TOOL:    { severity: 'warning', summary: 'Agent lists a tool the engine does not provide.' },
    UNKNOWN_TOOL:          { severity: 'error',   summary: 'Tool node names a tool the engine does not provide.' }
  };

  /**
   * Lint a flow and return structured diagnostics.
   *
   * @param {object} flow  {name, nodes, edges} — the standard flow data model.
   * @returns {{
   *   ok: boolean,                 // true when there are zero errors
   *   errorCount: number,
   *   warningCount: number,
   *   infoCount: number,
   *   diagnostics: Array<{
   *     severity: 'error'|'warning'|'info',
   *     code: string,              // a RULES key
   *     target: { kind: 'flow'|'node'|'edge', id: string|null },
   *     message: string
   *   }>
   * }}
   */
  function lintFlow(flow) {
    var diags = [];
    function add(code, kind, id, message) {
      var rule = RULES[code] || { severity: 'error' };
      diags.push({
        severity: rule.severity,
        code: code,
        target: { kind: kind, id: id == null ? null : String(id) },
        message: message
      });
    }

    if (!flow || typeof flow !== 'object') {
      add('FLOW_NOT_OBJECT', 'flow', null, 'The flow is not an object.');
      return finalize(diags);
    }

    var nodesOk = Array.isArray(flow.nodes);
    var edgesOk = Array.isArray(flow.edges);
    if (!nodesOk) add('NODES_NOT_ARRAY', 'flow', null, 'nodes must be an array.');
    if (!edgesOk) add('EDGES_NOT_ARRAY', 'flow', null, 'edges must be an array.');

    var nodes = nodesOk ? flow.nodes : [];
    var edges = edgesOk ? flow.edges : [];

    /* --- Nodes: identity, type, and per-type config ---------------------- */
    var byId = {};            // id -> node (first occurrence wins)
    var seenId = {};
    nodes.forEach(function (n, i) {
      var id = n && n.id;
      if (id == null || id === '') {
        add('NODE_MISSING_ID', 'node', null, 'Node at position ' + i + ' has no id.');
        return;
      }
      id = String(id);
      if (seenId[id]) {
        add('DUPLICATE_NODE_ID', 'node', id, 'Node id "' + id + '" is used more than once.');
      } else {
        seenId[id] = true;
        byId[id] = n;
      }
      var spec = NODE_SPECS[n.type];
      if (!spec) {
        add('UNKNOWN_NODE_TYPE', 'node', id, 'Node "' + id + '" has unknown type "' + n.type + '".');
        return;
      }
      lintNodeConfig(n, id, add);
    });

    /* --- Edges: shape, endpoints, ports ---------------------------------- */
    var incoming = {};        // nodeId -> count of valid incoming edges
    var outByPort = {};       // nodeId -> { port: outgoingCount }
    var adj = {};             // nodeId -> [toNodeId] for reachability + cycles
    nodes.forEach(function (n) {
      if (n && n.id != null) { adj[String(n.id)] = []; incoming[String(n.id)] = 0; outByPort[String(n.id)] = {}; }
    });

    var seenEdgeId = {};
    edges.forEach(function (e, i) {
      var eid = e && e.id != null && e.id !== '' ? String(e.id) : null;
      if (eid === null) {
        add('EDGE_MISSING_ID', 'edge', null, 'Edge at position ' + i + ' has no id.');
      } else if (seenEdgeId[eid]) {
        add('DUPLICATE_EDGE_ID', 'edge', eid, 'Edge id "' + eid + '" is used more than once.');
      } else {
        seenEdgeId[eid] = true;
      }
      var label = eid !== null ? eid : ('at position ' + i);

      if (!e || !e.from || !e.to || e.from.node == null || e.to.node == null) {
        add('EDGE_MALFORMED', 'edge', eid, 'Edge ' + label + ' is missing a from/to endpoint.');
        return;
      }
      var fromNode = String(e.from.node);
      var toNode = String(e.to.node);
      var fromPort = e.from.port;
      var toPort = e.to.port;

      var srcExists = Object.prototype.hasOwnProperty.call(byId, fromNode);
      var dstExists = Object.prototype.hasOwnProperty.call(byId, toNode);
      if (!srcExists) add('EDGE_DANGLING_SOURCE', 'edge', eid, 'Edge ' + label + ' starts at missing node "' + fromNode + '".');
      if (!dstExists) add('EDGE_DANGLING_TARGET', 'edge', eid, 'Edge ' + label + ' ends at missing node "' + toNode + '".');

      if (srcExists && dstExists && fromNode === toNode) {
        add('SELF_LOOP', 'edge', eid, 'Edge ' + label + ' connects node "' + fromNode + '" to itself.');
      }

      // Port validity (only checkable when the node exists and its type is known).
      if (srcExists) {
        var srcSpec = NODE_SPECS[byId[fromNode].type];
        if (srcSpec && srcSpec.outputs.indexOf(fromPort) === -1) {
          add('INVALID_SOURCE_PORT', 'edge', eid,
            'Edge ' + label + ' leaves port "' + fromPort + '" of "' + fromNode +
            '", which has outputs [' + srcSpec.outputs.join(', ') + '].');
        }
      }
      if (dstExists) {
        var dstSpec = NODE_SPECS[byId[toNode].type];
        if (dstSpec && dstSpec.inputs.indexOf(toPort) === -1) {
          add('INVALID_TARGET_PORT', 'edge', eid,
            'Edge ' + label + ' enters port "' + toPort + '" of "' + toNode +
            '", which has inputs [' + dstSpec.inputs.join(', ') + '].');
        }
      }

      // Record graph structure for reachability / cycle / satisfaction checks.
      // Only well-formed, both-ends-existing, non-self edges count as real data flow.
      if (srcExists && dstExists && fromNode !== toNode) {
        adj[fromNode].push(toNode);
        incoming[toNode] += 1;
        outByPort[fromNode][fromPort] = (outByPort[fromNode][fromPort] || 0) + 1;
      }
    });

    /* --- Whole-graph structure ------------------------------------------- */
    if (nodes.length === 0) {
      if (nodesOk) add('EMPTY_FLOW', 'flow', null, 'The flow has no nodes.');
      return finalize(diags);
    }

    var validNodes = Object.keys(byId).map(function (id) { return byId[id]; });
    var triggerIds = validNodes.filter(function (n) { return n.type === 'trigger'; }).map(function (n) { return String(n.id); });
    var hasOutput = validNodes.some(function (n) { return n.type === 'output'; });

    if (triggerIds.length === 0) add('NO_TRIGGER', 'flow', null, 'Add a Trigger node — a flow needs an entry point to run.');
    if (!hasOutput) add('NO_OUTPUT', 'flow', null, 'Add an Output node — otherwise the flow captures no result.');

    // Cycle detection (Kahn's algorithm) that also NAMES the nodes on the cycle.
    var cycleNodes = findCycleNodes(byId, adj, incoming);
    if (cycleNodes.length) {
      add('CYCLE', 'flow', null,
        'Cycle involving node(s): ' + cycleNodes.join(', ') + '. Flows must be acyclic (DAG).');
    }

    // Reachability from all Triggers (both Condition branches count statically).
    var reachable = reachableFrom(triggerIds, adj);

    validNodes.forEach(function (n) {
      var id = String(n.id);
      var spec = NODE_SPECS[n.type];
      if (!spec) return; // already reported UNKNOWN_NODE_TYPE

      // Required input: any non-trigger node must have at least one incoming edge.
      if (spec.inputs.length > 0 && incoming[id] === 0) {
        add('UNSATISFIED_INPUT', 'node', id,
          'Node "' + id + '" (' + spec.label + ') has an input port but no incoming edge — it can never receive a payload.');
      } else if (n.type !== 'trigger' && !reachable[id]) {
        // Fed only by other unreachable nodes: distinct from "no input at all".
        add('UNREACHABLE_NODE', 'node', id,
          'Node "' + id + '" (' + spec.label + ') is not reachable from any Trigger — it will be skipped at run time.');
      }

      // Dead end: a node that produces output but wires none of it anywhere.
      if (spec.outputs.length > 0) {
        var anyWired = spec.outputs.some(function (p) { return (outByPort[id][p] || 0) > 0; });
        if (!anyWired) {
          add('DEAD_END', 'node', id,
            'Node "' + id + '" (' + spec.label + ') has output port(s) [' + spec.outputs.join(', ') +
            '] but none are wired — its result goes nowhere.');
        }
      }
    });

    return finalize(diags);
  }

  /* --- Per-node config checks (tools) ------------------------------------ */
  function lintNodeConfig(node, id, add) {
    var config = node.config || {};
    if (node.type === 'agent') {
      var tools = Array.isArray(config.tools) ? config.tools : [];
      if (tools.length === 0) {
        add('EMPTY_TOOLBELT', 'node', id, 'Agent "' + id + '" has an empty toolbelt; it will respond directly without calling a tool.');
      }
      // Report each unknown tool once, in sorted order for determinism.
      var unknown = tools.filter(function (t) { return !Object.prototype.hasOwnProperty.call(TOOLS, t); });
      dedupeSorted(unknown).forEach(function (t) {
        add('UNKNOWN_AGENT_TOOL', 'node', id, 'Agent "' + id + '" lists tool "' + t + '", which the engine does not provide.');
      });
    } else if (node.type === 'tool') {
      var tool = config.tool;
      if (!Object.prototype.hasOwnProperty.call(TOOLS, tool)) {
        add('UNKNOWN_TOOL', 'node', id, 'Tool node "' + id + '" uses tool "' + tool + '", which the engine does not provide (it would error at run time).');
      }
    }
  }

  /* --- Graph helpers ----------------------------------------------------- */

  // Kahn's algorithm; returns the sorted ids of nodes that could not be ordered
  // (i.e. are on or downstream of a cycle). Empty array === acyclic.
  function findCycleNodes(byId, adj, incomingCounts) {
    var indeg = {};
    Object.keys(byId).forEach(function (id) { indeg[id] = incomingCounts[id] || 0; });
    var queue = Object.keys(byId).filter(function (id) { return indeg[id] === 0; }).sort();
    var removed = {};
    while (queue.length) {
      var id = queue.shift();
      removed[id] = true;
      adj[id].slice().sort().forEach(function (next) {
        indeg[next] -= 1;
        if (indeg[next] === 0) { queue.push(next); queue.sort(); }
      });
    }
    return Object.keys(byId).filter(function (id) { return !removed[id]; }).sort();
  }

  // Forward BFS from the given start ids over the adjacency list.
  function reachableFrom(startIds, adj) {
    var seen = {};
    var stack = startIds.slice();
    startIds.forEach(function (id) { seen[id] = true; });
    while (stack.length) {
      var id = stack.pop();
      (adj[id] || []).forEach(function (next) {
        if (!seen[next]) { seen[next] = true; stack.push(next); }
      });
    }
    return seen;
  }

  function dedupeSorted(arr) {
    var out = [];
    arr.slice().sort().forEach(function (v) { if (out[out.length - 1] !== v) out.push(v); });
    return out;
  }

  // Sort diagnostics into a stable, deterministic order and tally counts.
  function finalize(diags) {
    diags.sort(function (a, b) {
      if (SEV_RANK[a.severity] !== SEV_RANK[b.severity]) return SEV_RANK[a.severity] - SEV_RANK[b.severity];
      if (a.code !== b.code) return a.code < b.code ? -1 : 1;
      if (a.target.kind !== b.target.kind) return a.target.kind < b.target.kind ? -1 : 1;
      var ai = a.target.id || '';
      var bi = b.target.id || '';
      if (ai !== bi) return ai < bi ? -1 : 1;
      if (a.message !== b.message) return a.message < b.message ? -1 : 1;
      return 0;
    });
    var errorCount = 0, warningCount = 0, infoCount = 0;
    diags.forEach(function (d) {
      if (d.severity === 'error') errorCount += 1;
      else if (d.severity === 'warning') warningCount += 1;
      else infoCount += 1;
    });
    return {
      ok: errorCount === 0,
      errorCount: errorCount,
      warningCount: warningCount,
      infoCount: infoCount,
      diagnostics: diags
    };
  }

  /* --- Presentation helpers (shared by the CLI report and the UI) -------- */

  // One-line summary, e.g. "2 errors, 1 warning" or "clean".
  function summaryLine(result) {
    if (!result.diagnostics.length) return 'clean — no problems found';
    var parts = [];
    if (result.errorCount) parts.push(plural(result.errorCount, 'error'));
    if (result.warningCount) parts.push(plural(result.warningCount, 'warning'));
    if (result.infoCount) parts.push(plural(result.infoCount, 'note'));
    return parts.join(', ');
  }

  // A flat list of "SEVERITY  CODE  [target]  message" lines (for terminal/UI).
  function formatLines(result) {
    return result.diagnostics.map(function (d) {
      var where = d.target.kind + (d.target.id ? ' ' + d.target.id : '');
      return d.severity.toUpperCase() + '  ' + d.code + '  [' + where + ']  ' + d.message;
    });
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /* --- Public API -------------------------------------------------------- */
  return {
    SEVERITY: SEVERITY,
    RULES: RULES,
    lintFlow: lintFlow,
    summaryLine: summaryLine,
    formatLines: formatLines
  };
});
