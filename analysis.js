/*
 * agent-flow-studio — analysis.js
 * -----------------------------------------------------------------------------
 * A pure, dependency-free DATA-DEPENDENCY / PROVENANCE analyzer for a flow. Given
 * the same plain {name, nodes, edges} data model the engine, linter and UI share,
 * it computes the *static* structure of the graph — who depends on whom — and
 * returns a deterministic, structured report:
 *
 *   - dependsOn / feeds      : each node's direct predecessors / successors.
 *   - ancestors / descendants: the transitive upstream / downstream closure.
 *   - order                  : a topological run order (matches the engine's).
 *   - stages                 : nodes grouped by topological level. Nodes in the
 *                              same stage have no dependency between them, so they
 *                              are the steps that COULD run in parallel — a view
 *                              the sequential executor does not expose.
 *   - criticalPath / depth   : one longest dependency chain, i.e. the minimum
 *                              number of sequential stages the flow needs.
 *   - sources / sinks        : nodes with no incoming / outgoing dependency.
 *   - provenance             : which Trigger(s) feed which Output(s), and vice
 *                              versa — the flow's data lineage.
 *
 * This is deliberately COMPLEMENTARY to the two pieces that already exist:
 *   - engine.js RUNS one data-dependent path (a Condition prunes a branch at run
 *     time based on the payload); this module never runs anything.
 *   - linter.js checks VALIDITY (cycles, unreachable nodes, bad wiring, ...);
 *     this module assumes a structurally-sound flow and describes its shape.
 * Neither of them computes dependency closures, parallel stages, the critical
 * path, or trigger→output lineage — that is what this adds.
 *
 * Honesty note: this is a STATIC analysis over the graph edges and node types
 * alone. Like the linter, it treats BOTH branches of a Condition as reachable —
 * it does NOT follow the single data-dependent branch a Condition takes at run
 * time, and it does not reason about payload contents. So "provenance",
 * "stages" and "descendants" describe POTENTIAL data flow (every path the wiring
 * permits), not the one path a given input actually takes. Edges that dangle
 * (an endpoint is not a real node) and self-loops are excluded from the
 * dependency graph, exactly as the linter excludes them; a self-loop is instead
 * reported as a cycle, so `acyclic` is false and the order-dependent fields are
 * withheld.
 *
 * Like engine.js, linter.js and snapshot.js it is a tiny UMD module so the EXACT
 * same code runs in the browser (window.AgentFlowAnalysis) and in the Node test
 * suite (require('./analysis.js')). The output is a pure, deterministic function
 * of the input flow: every list is sorted into a stable order, so a re-run is
 * byte-identical (no Date, no randomness).
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
    root.AgentFlowAnalysis = factory(root.AgentFlowEngine);
  }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  var NODE_SPECS = E.NODE_SPECS; // source of truth for node types

  /**
   * Analyze a flow's data-dependency structure.
   *
   * @param {object} flow  {name, nodes, edges} — the standard flow data model.
   * @returns {{
   *   nodeCount: number,
   *   edgeCount: number,               // raw edge count (before filtering)
   *   acyclic: boolean,                // false if any cycle or self-loop exists
   *   cycleNodes: string[],            // sorted node ids on/downstream of a cycle
   *   order: string[]|null,            // topological order (null if not acyclic)
   *   sources: string[],               // nodes with no dependency feeding them
   *   sinks: string[],                 // nodes whose output feeds nothing
   *   stages: string[][],              // level 0..n; stage[k] could run in parallel
   *   criticalPath: string[],          // one longest dependency chain
   *   depth: number,                   // criticalPath.length
   *   triggers: string[],
   *   outputs: string[],
   *   provenance: {
   *     byOutput: { [outputId]: string[] },   // triggers that can reach this output
   *     byTrigger: { [triggerId]: string[] }  // outputs this trigger can reach
   *   },
   *   nodes: { [id]: {
   *     type: string,
   *     dependsOn: string[], feeds: string[],
   *     ancestors: string[], descendants: string[],
   *     indegree: number, outdegree: number,   // distinct predecessor / successor nodes
   *     level: number|null                     // topological depth; null if not acyclic
   *   } }
   * }}
   */
  function analyzeFlow(flow) {
    var nodesArr = flow && Array.isArray(flow.nodes) ? flow.nodes : [];
    var edgesArr = flow && Array.isArray(flow.edges) ? flow.edges : [];

    // De-duplicated node index (first occurrence wins), matching linter.js.
    var byId = {};
    var ids = [];
    nodesArr.forEach(function (n) {
      if (!n || n.id == null || n.id === '') return;
      var id = String(n.id);
      if (Object.prototype.hasOwnProperty.call(byId, id)) return;
      byId[id] = n;
      ids.push(id);
    });
    ids.sort();

    // Dependency adjacency from real, non-self edges. A "real" edge has both
    // endpoints among the known nodes; dangling and self-loop edges are excluded
    // from the dependency graph (exactly as linter.js treats them).
    var succ = {}; // id -> set of successor ids
    var pred = {}; // id -> set of predecessor ids
    ids.forEach(function (id) { succ[id] = {}; pred[id] = {}; });
    var selfLoop = {};
    edgesArr.forEach(function (e) {
      if (!e || !e.from || !e.to || e.from.node == null || e.to.node == null) return;
      var from = String(e.from.node);
      var to = String(e.to.node);
      if (!byId[from] || !byId[to]) return;         // dangling endpoint
      if (from === to) { selfLoop[from] = true; return; } // self-loop == cycle
      succ[from][to] = true;
      pred[to][from] = true;
    });

    function keysSorted(obj) { return Object.keys(obj).sort(); }

    // --- Topological order + cycle detection (Kahn's algorithm) -------------
    // Seeded and drained in sorted id order so the result is deterministic and
    // matches engine.topoSort for a well-formed DAG (single source of truth for
    // "what order does this run in").
    var indeg = {};
    ids.forEach(function (id) { indeg[id] = Object.keys(pred[id]).length; });
    var queue = ids.filter(function (id) { return indeg[id] === 0; }).sort();
    var order = [];
    var removed = {};
    while (queue.length) {
      var id = queue.shift();
      order.push(id);
      removed[id] = true;
      keysSorted(succ[id]).forEach(function (next) {
        indeg[next] -= 1;
        if (indeg[next] === 0) { queue.push(next); queue.sort(); }
      });
    }
    // A cycle: any node Kahn could not remove, plus any self-looping node.
    var cycleSet = {};
    ids.forEach(function (id) { if (!removed[id]) cycleSet[id] = true; });
    Object.keys(selfLoop).forEach(function (id) { cycleSet[id] = true; });
    var cycleNodes = Object.keys(cycleSet).sort();
    var acyclic = cycleNodes.length === 0;

    // --- Transitive closures (robust to cycles via a visited set) -----------
    function closure(seedSet, adj) {
      var seen = {};
      var stack = Object.keys(seedSet);
      stack.forEach(function (s) { seen[s] = true; });
      while (stack.length) {
        var cur = stack.pop();
        Object.keys(adj[cur] || {}).forEach(function (nx) {
          if (!seen[nx]) { seen[nx] = true; stack.push(nx); }
        });
      }
      return seen;
    }

    // --- Levels, stages and critical path (DAG only) ------------------------
    var level = {};
    var stages = [];
    var criticalPath = [];
    if (acyclic) {
      // level = longest path (in edges) from any source; computed over the topo
      // order so every predecessor is finalized before the node that needs it.
      order.forEach(function (nid) {
        var lvl = 0;
        Object.keys(pred[nid]).forEach(function (p) {
          if (level[p] + 1 > lvl) lvl = level[p] + 1;
        });
        level[nid] = lvl;
      });
      var maxLvl = -1;
      ids.forEach(function (nid) { if (level[nid] > maxLvl) maxLvl = level[nid]; });
      for (var k = 0; k <= maxLvl; k++) {
        (function (kk) {
          stages.push(ids.filter(function (nid) { return level[nid] === kk; }).sort());
        })(k);
      }
      if (ids.length) {
        // End at the deepest node (smallest id wins ties), then walk back along
        // predecessors that sit exactly one level up (smallest id at each step),
        // giving one deterministic longest chain.
        var end = null;
        ids.forEach(function (nid) { if (end === null || level[nid] > level[end]) end = nid; });
        var chain = [end];
        var cur2 = end;
        while (level[cur2] > 0) {
          var best = null;
          keysSorted(pred[cur2]).forEach(function (p) {
            if (best === null && level[p] === level[cur2] - 1) best = p;
          });
          if (best === null) break; // unreachable in a valid DAG
          chain.push(best);
          cur2 = best;
        }
        criticalPath = chain.reverse();
      }
    }

    // --- Per-node detail ----------------------------------------------------
    var nodes = {};
    ids.forEach(function (id2) {
      var anc = closure(pred[id2], pred);
      delete anc[id2]; // a node is never its own ancestor (only self via a cycle)
      var desc = closure(succ[id2], succ);
      delete desc[id2];
      var dependsOn = keysSorted(pred[id2]);
      var feeds = keysSorted(succ[id2]);
      nodes[id2] = {
        type: byId[id2].type,
        dependsOn: dependsOn,
        feeds: feeds,
        ancestors: Object.keys(anc).sort(),
        descendants: Object.keys(desc).sort(),
        indegree: dependsOn.length,
        outdegree: feeds.length,
        level: acyclic ? level[id2] : null
      };
    });

    // --- Sources / sinks ----------------------------------------------------
    var sources = ids.filter(function (id3) { return nodes[id3].indegree === 0; }).sort();
    var sinks = ids.filter(function (id3) { return nodes[id3].outdegree === 0; }).sort();

    // --- Provenance (trigger <-> output lineage) ----------------------------
    var triggers = ids.filter(function (id4) { return byId[id4].type === 'trigger'; }).sort();
    var outputs = ids.filter(function (id4) { return byId[id4].type === 'output'; }).sort();
    var byOutput = {};
    outputs.forEach(function (o) {
      byOutput[o] = nodes[o].ancestors.filter(function (a) {
        return byId[a] && byId[a].type === 'trigger';
      }).sort();
    });
    var byTrigger = {};
    triggers.forEach(function (t) {
      byTrigger[t] = nodes[t].descendants.filter(function (d) {
        return byId[d] && byId[d].type === 'output';
      }).sort();
    });

    return {
      nodeCount: ids.length,
      edgeCount: edgesArr.length,
      acyclic: acyclic,
      cycleNodes: cycleNodes,
      order: acyclic ? order.slice() : null,
      sources: sources,
      sinks: sinks,
      stages: stages,
      criticalPath: criticalPath,
      depth: criticalPath.length,
      triggers: triggers,
      outputs: outputs,
      provenance: { byOutput: byOutput, byTrigger: byTrigger },
      nodes: nodes
    };
  }

  /* --- Presentation helpers (shared by the CLI report and the UI) --------- */

  // One-line summary, e.g. "7 nodes, 6 edges; 4 stages, critical path 4 deep".
  function summarize(result) {
    if (result.nodeCount === 0) return 'empty flow — nothing to analyze';
    var shape = result.acyclic
      ? (result.stages.length + ' stage' + plural(result.stages.length) +
         ', critical path ' + result.depth + ' node' + plural(result.depth) + ' deep')
      : 'NOT a DAG — cycle involving ' + result.cycleNodes.join(', ');
    return result.nodeCount + ' node' + plural(result.nodeCount) + ', ' +
      result.edgeCount + ' edge' + plural(result.edgeCount) + '; ' + shape;
  }

  // A compact, deterministic multi-line description for a terminal or the UI.
  function describe(result) {
    var lines = [summarize(result)];
    if (result.nodeCount === 0) return lines;
    if (result.acyclic) {
      lines.push('order: ' + result.order.join(' -> '));
      lines.push('stages: ' + result.stages.map(function (s) { return '[' + s.join(', ') + ']'; }).join('  '));
      lines.push('critical path: ' + result.criticalPath.join(' -> '));
    } else {
      lines.push('cycle: ' + result.cycleNodes.join(', ') + ' (order/stages withheld)');
    }
    result.outputs.forEach(function (o) {
      var from = result.provenance.byOutput[o];
      lines.push('provenance: output "' + o + '" <- ' + (from.length ? 'trigger(s) ' + from.join(', ') : 'NO trigger (unreachable)'));
    });
    return lines;
  }

  function plural(n) { return n === 1 ? '' : 's'; }

  /* --- Public API --------------------------------------------------------- */
  return {
    analyzeFlow: analyzeFlow,
    summarize: summarize,
    describe: describe
  };
});
