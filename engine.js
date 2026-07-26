/*
 * agent-flow-studio — engine.js
 * -----------------------------------------------------------------------------
 * The pure, side-effect-free graph-execution engine.
 *
 * This file is deliberately isolated from any DOM / browser concern so that the
 * *exact same code* runs in two places:
 *   1. The browser UI (loaded via <script src="engine.js">, exposed as
 *      window.AgentFlowEngine).
 *   2. The Node test suite (require('./engine.js')), run headless in CI.
 *
 * It uses a tiny UMD shim to support both without a build step or dependencies.
 *
 * Author: Dimitres Kisimov. © 2026 — all rights reserved (portfolio review only; see LICENSE).
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    // Node / CommonJS
    module.exports = factory();
  } else {
    // Browser global
    root.AgentFlowEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ===========================================================================
   * Node specifications
   * ---------------------------------------------------------------------------
   * Every node type declares its input/output ports and a default config. The
   * UI reads this to render the palette and side panel; the engine reads it to
   * validate flows. Keeping it here (in the engine) means the browser and the
   * tests share one source of truth.
   * ========================================================================= */
  var NODE_SPECS = {
    trigger: {
      type: 'trigger',
      label: 'Trigger',
      description: 'Entry point. Emits an initial payload into the flow.',
      inputs: [],
      outputs: ['out'],
      defaultConfig: { text: 'New RFQ: 500x M8 hex bolts, need a quote urgently.' }
    },
    agent: {
      type: 'agent',
      label: 'LLM Agent',
      description: 'Mock reasoning engine. Picks a tool from its toolbelt using deterministic rules, so it feels agentic without any API.',
      inputs: ['in'],
      outputs: ['out'],
      defaultConfig: { tools: ['lookup-price', 'classify', 'escalate', 'search-kb'] }
    },
    tool: {
      type: 'tool',
      label: 'Tool',
      description: 'A deterministic transform (classify, lookup-price, escalate, ...).',
      inputs: ['in'],
      outputs: ['out'],
      defaultConfig: { tool: 'classify' }
    },
    condition: {
      type: 'condition',
      label: 'Condition',
      description: 'Branches the flow. Routes to "true" or "false" based on a predicate over the payload.',
      inputs: ['in'],
      outputs: ['true', 'false'],
      defaultConfig: { field: 'text', op: 'contains', value: 'urgent' }
    },
    output: {
      type: 'output',
      label: 'Output',
      description: 'Terminal node. Records the final payload it receives.',
      inputs: ['in'],
      outputs: [],
      defaultConfig: { label: 'Result' }
    }
  };

  /* ===========================================================================
   * Tool library
   * ---------------------------------------------------------------------------
   * Each tool is a pure function: payload -> new payload. Deterministic so the
   * tests can assert exact outputs. Tools never mutate their input.
   * ========================================================================= */
  var TOOLS = {
    'classify': function (payload) {
      var text = lower(payload.text);
      var category = 'general';
      if (/\b(rfq|quote|quotation|price|cost|bolt|screw|order)\b/.test(text)) category = 'sales';
      else if (/\b(invoice|billing|payment|refund)\b/.test(text)) category = 'billing';
      else if (/\b(broken|error|fault|not working|defect|down|outage)\b/.test(text)) category = 'support';
      return assign(payload, { category: category });
    },
    'lookup-price': function (payload) {
      // Deterministic pseudo-pricing derived from the payload text length so the
      // result is stable and testable (no randomness, no network).
      var qty = extractNumber(payload.text) || 1;
      var unit = 0.42; // fixed catalog unit price
      var total = round2(qty * unit);
      return assign(payload, { quantity: qty, unitPrice: unit, quote: total });
    },
    'escalate': function (payload) {
      return assign(payload, { escalated: true, priority: 'high' });
    },
    'search-kb': function (payload) {
      var text = lower(payload.text);
      var hit = /\b(how|what|where|install|setup|guide)\b/.test(text)
        ? 'kb-article-1042'
        : 'no-match';
      return assign(payload, { kbArticle: hit });
    },
    'billing-lookup': function (payload) {
      return assign(payload, { account: 'ACME-001', balance: 1280.5 });
    },
    'notify': function (payload) {
      return assign(payload, { notified: true, channel: 'email' });
    }
  };

  var TOOL_NAMES = Object.keys(TOOLS);

  /* ===========================================================================
   * Mock agent reasoning
   * ---------------------------------------------------------------------------
   * The heart of the "agentic" feel. Given an input payload and the tools the
   * agent is allowed to use, it deterministically selects ONE tool by matching
   * keywords, then runs it. Returns a structured decision so the trace can show
   * *why* the agent acted — mirroring how a real LLM agent narrates tool use.
   * ========================================================================= */
  var AGENT_RULES = [
    { tool: 'lookup-price', keywords: ['price', 'quote', 'quotation', 'rfq', 'cost', 'bolt', 'screw'] },
    { tool: 'escalate',     keywords: ['urgent', 'asap', 'critical', 'immediately', 'outage', 'down'] },
    { tool: 'billing-lookup', keywords: ['invoice', 'billing', 'payment', 'refund', 'charge'] },
    { tool: 'search-kb',    keywords: ['how', 'what', 'where', 'help', 'install', 'setup', 'guide'] },
    { tool: 'classify',     keywords: ['category', 'route', 'classify', 'triage'] }
  ];

  /**
   * Decide which tool the agent should use.
   * @param {object} payload    - current payload (expects a `text` field)
   * @param {string[]} tools    - tool names the agent is permitted to use
   * @returns {{chosenTool:string|null, reasoning:string, matched:string|null}}
   */
  function mockAgentReason(payload, tools) {
    var allowed = Array.isArray(tools) ? tools : [];
    var text = lower(payload && payload.text);

    for (var i = 0; i < AGENT_RULES.length; i++) {
      var rule = AGENT_RULES[i];
      if (allowed.indexOf(rule.tool) === -1) continue;
      for (var k = 0; k < rule.keywords.length; k++) {
        var kw = rule.keywords[k];
        if (text.indexOf(kw) !== -1) {
          return {
            chosenTool: rule.tool,
            matched: kw,
            reasoning: 'Saw "' + kw + '" in the input, so I picked the ' + rule.tool + ' tool.'
          };
        }
      }
    }
    // Fallback: use the first allowed tool, or "respond" if the agent has none.
    if (allowed.length > 0) {
      return {
        chosenTool: allowed[0],
        matched: null,
        reasoning: 'No keyword matched; defaulting to my first tool (' + allowed[0] + ').'
      };
    }
    return {
      chosenTool: null,
      matched: null,
      reasoning: 'No tools available; responding directly.'
    };
  }

  /* ===========================================================================
   * Topological sort
   * ---------------------------------------------------------------------------
   * Kahn's algorithm. Returns node ids in an order where every node appears
   * after all nodes that feed into it. Throws on a cycle (agent flows must be
   * DAGs). Nodes are compared in a stable way so the order is deterministic.
   * ========================================================================= */
  function topoSort(flow) {
    var nodes = flow.nodes || [];
    var edges = flow.edges || [];

    var indegree = {};
    var adj = {};
    var ids = [];
    nodes.forEach(function (n) {
      indegree[n.id] = 0;
      adj[n.id] = [];
      ids.push(n.id);
    });

    edges.forEach(function (e) {
      var from = e.from.node;
      var to = e.to.node;
      if (adj[from] === undefined || indegree[to] === undefined) return; // dangling edge, ignore
      adj[from].push(to);
      indegree[to]++;
    });

    // Seed the queue with all zero-indegree nodes, kept sorted for determinism.
    var queue = ids.filter(function (id) { return indegree[id] === 0; }).sort();
    var order = [];

    while (queue.length) {
      var id = queue.shift();
      order.push(id);
      // Sort neighbours for deterministic output.
      adj[id].slice().sort().forEach(function (next) {
        indegree[next]--;
        if (indegree[next] === 0) {
          queue.push(next);
          queue.sort();
        }
      });
    }

    if (order.length !== ids.length) {
      throw new Error('Flow contains a cycle — agent flows must be acyclic (DAG).');
    }
    return order;
  }

  /* ===========================================================================
   * Flow execution
   * ---------------------------------------------------------------------------
   * Walks the nodes in topological order. Each node reads the payload arriving
   * on its input port(s) and writes a payload to its output port(s). Condition
   * nodes only emit on ONE port, which naturally prunes a branch. Nodes that
   * never receive a payload are skipped (recorded in the trace as "skipped").
   *
   * Returns { trace, outputs, order } where:
   *   - trace   : ordered list of execution steps (for the live UI)
   *   - outputs : payloads captured by Output nodes, keyed by node id
   *   - order   : the topological order used
   * ========================================================================= */
  function runFlow(flow) {
    var order = topoSort(flow);
    var nodesById = indexBy(flow.nodes || [], 'id');
    var edges = flow.edges || [];

    // portValues[nodeId][port] = payload delivered to that input port.
    var inbox = {};
    var trace = [];
    var outputs = {};

    function deliver(fromNode, fromPort, payload) {
      edges.forEach(function (e) {
        if (e.from.node === fromNode && e.from.port === fromPort) {
          if (!inbox[e.to.node]) inbox[e.to.node] = {};
          inbox[e.to.node][e.to.port] = payload;
        }
      });
    }

    function firstInput(nodeId) {
      var box = inbox[nodeId];
      if (!box) return null;
      var keys = Object.keys(box);
      return keys.length ? clone(box[keys[0]]) : null;
    }

    order.forEach(function (nodeId) {
      var node = nodesById[nodeId];
      if (!node) return;
      var spec = NODE_SPECS[node.type];
      var config = node.config || {};

      // Non-trigger nodes with no delivered input are unreachable -> skip.
      if (node.type !== 'trigger' && !inbox[nodeId]) {
        trace.push({ nodeId: nodeId, type: node.type, status: 'skipped', detail: 'No input reached this node.', output: null });
        return;
      }

      var input = firstInput(nodeId);
      var step = { nodeId: nodeId, type: node.type, status: 'ok', input: input, output: null, detail: '' };

      switch (node.type) {
        case 'trigger': {
          var payload = { text: String(config.text != null ? config.text : '') };
          step.output = payload;
          step.detail = 'Emitted initial payload.';
          deliver(nodeId, 'out', payload);
          break;
        }
        case 'agent': {
          var decision = mockAgentReason(input, config.tools || []);
          var out = clone(input) || {};
          out.agentDecision = decision.chosenTool;
          out.agentReasoning = decision.reasoning;
          if (decision.chosenTool && TOOLS[decision.chosenTool]) {
            out = TOOLS[decision.chosenTool](out);
            step.detail = decision.reasoning + ' Ran tool "' + decision.chosenTool + '".';
          } else {
            step.detail = decision.reasoning;
          }
          step.output = out;
          step.agentDecision = decision;
          deliver(nodeId, 'out', out);
          break;
        }
        case 'tool': {
          var toolName = config.tool;
          var fn = TOOLS[toolName];
          if (!fn) {
            step.status = 'error';
            step.detail = 'Unknown tool "' + toolName + '".';
            step.output = input;
          } else {
            step.output = fn(input || {});
            step.detail = 'Applied tool "' + toolName + '".';
          }
          deliver(nodeId, 'out', step.output);
          break;
        }
        case 'condition': {
          var result = evalPredicate(input || {}, config);
          step.output = input;
          step.detail = 'Predicate (' + config.field + ' ' + config.op + ' "' + config.value + '") => ' + result;
          step.branch = result ? 'true' : 'false';
          deliver(nodeId, result ? 'true' : 'false', input);
          break;
        }
        case 'output': {
          step.output = input;
          step.detail = 'Captured final payload.';
          outputs[nodeId] = { label: (config.label || (spec && spec.label) || 'Result'), payload: input };
          break;
        }
        default: {
          step.status = 'error';
          step.detail = 'Unknown node type "' + node.type + '".';
        }
      }

      trace.push(step);
    });

    return { trace: trace, outputs: outputs, order: order };
  }

  /* ===========================================================================
   * Predicate evaluation (for Condition nodes)
   * ========================================================================= */
  function evalPredicate(payload, config) {
    var field = config.field || 'text';
    var op = config.op || 'contains';
    var value = config.value;
    var actual = payload[field];

    switch (op) {
      case 'contains':
        return lower(actual).indexOf(lower(value)) !== -1;
      case 'equals':
        return String(actual) === String(value);
      case 'not-equals':
        return String(actual) !== String(value);
      case 'gt':
        return Number(actual) > Number(value);
      case 'lt':
        return Number(actual) < Number(value);
      case 'exists':
        return actual !== undefined && actual !== null;
      default:
        return false;
    }
  }

  /* ===========================================================================
   * Serialization (JSON round-trip)
   * ---------------------------------------------------------------------------
   * A flow is already plain data, but these helpers normalize the shape and
   * validate on import so a hand-edited or corrupt file fails loudly.
   * ========================================================================= */
  var FLOW_VERSION = 1;

  function serializeFlow(flow) {
    return JSON.stringify({
      version: FLOW_VERSION,
      name: flow.name || 'Untitled flow',
      nodes: (flow.nodes || []).map(function (n) {
        return { id: n.id, type: n.type, x: n.x, y: n.y, config: n.config || {} };
      }),
      edges: (flow.edges || []).map(function (e) {
        return { id: e.id, from: { node: e.from.node, port: e.from.port }, to: { node: e.to.node, port: e.to.port } };
      })
    }, null, 2);
  }

  function deserializeFlow(json) {
    var data = typeof json === 'string' ? JSON.parse(json) : json;
    var flow = {
      version: data.version || FLOW_VERSION,
      name: data.name || 'Untitled flow',
      nodes: (data.nodes || []).map(function (n) {
        return { id: n.id, type: n.type, x: n.x || 0, y: n.y || 0, config: n.config || {} };
      }),
      edges: (data.edges || []).map(function (e) {
        return { id: e.id, from: { node: e.from.node, port: e.from.port }, to: { node: e.to.node, port: e.to.port } };
      })
    };
    var problems = validateFlow(flow);
    if (problems.length) {
      throw new Error('Invalid flow: ' + problems.join('; '));
    }
    return flow;
  }

  /* ===========================================================================
   * Validation
   * ---------------------------------------------------------------------------
   * Returns an array of human-readable problems (empty === valid).
   * ========================================================================= */
  function validateFlow(flow) {
    var problems = [];
    if (!flow || typeof flow !== 'object') return ['Flow is not an object.'];
    if (!Array.isArray(flow.nodes)) problems.push('nodes must be an array.');
    if (!Array.isArray(flow.edges)) problems.push('edges must be an array.');
    if (problems.length) return problems;

    var ids = {};
    flow.nodes.forEach(function (n) {
      if (!n.id) problems.push('A node is missing an id.');
      if (ids[n.id]) problems.push('Duplicate node id: ' + n.id);
      ids[n.id] = true;
      if (!NODE_SPECS[n.type]) problems.push('Unknown node type: ' + n.type + ' (node ' + n.id + ')');
    });

    flow.edges.forEach(function (e) {
      if (!e.from || !e.to) { problems.push('Edge ' + (e.id || '?') + ' is malformed.'); return; }
      if (!ids[e.from.node]) problems.push('Edge ' + e.id + ' references missing node ' + e.from.node);
      if (!ids[e.to.node]) problems.push('Edge ' + e.id + ' references missing node ' + e.to.node);
    });

    // A DAG check (surfaces cycles at import time rather than at run time).
    try { topoSort(flow); } catch (err) { problems.push(err.message); }

    return problems;
  }

  /* ===========================================================================
   * Small pure helpers
   * ========================================================================= */
  function lower(v) { return String(v == null ? '' : v).toLowerCase(); }
  function assign(base, extra) {
    var out = {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    for (var j in extra) if (Object.prototype.hasOwnProperty.call(extra, j)) out[j] = extra[j];
    return out;
  }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function indexBy(arr, key) {
    var out = {};
    arr.forEach(function (item) { out[item[key]] = item; });
    return out;
  }
  function round2(n) { return Math.round(n * 100) / 100; }
  function extractNumber(text) {
    var m = String(text || '').match(/\d[\d,]*/);
    return m ? parseInt(m[0].replace(/,/g, ''), 10) : null;
  }

  /* ===========================================================================
   * Public API
   * ========================================================================= */
  return {
    NODE_SPECS: NODE_SPECS,
    TOOLS: TOOLS,
    TOOL_NAMES: TOOL_NAMES,
    AGENT_RULES: AGENT_RULES,
    mockAgentReason: mockAgentReason,
    topoSort: topoSort,
    runFlow: runFlow,
    evalPredicate: evalPredicate,
    serializeFlow: serializeFlow,
    deserializeFlow: deserializeFlow,
    validateFlow: validateFlow,
    FLOW_VERSION: FLOW_VERSION
  };
});
