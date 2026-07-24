# Business case — a self-serve canvas for simple AI automations

*A one-page case for using a visual, self-serve flow builder to take small
automation requests off the engineering queue. The company and scenario are
invented for illustration; the product behaviour it describes is what this repo
actually does. The cost figures are an illustrative model, labelled as estimates —
this repo is the working proof-of-concept of the pattern, not a production
platform.*

## Situation

**Meridian Services Group** (fictional mid-size B2B services company, ~600 staff)
has an operations team that keeps getting the same shape of request from support,
sales and finance: "route these tickets by topic", "triage these inbound emails",
"escalate anything marked urgent". Each one is a small automation — a trigger, a
decision, a couple of tool steps. Today every one of them is a ticket in the
**engineering** backlog, because there is no way for a business user to assemble
one themselves.

## Problem (quantified)

Small automations compete with real product work for engineering time, and they
wait. The arithmetic, with assumptions stated:

| Assumption | Value |
|---|---|
| Small-automation requests per year | 40 |
| Engineering effort each (build + review + deploy) | ~3 days = 24 h |
| Fully-loaded engineer cost (salary + overhead) | €70 / hour |
| Typical queue wait before work starts | 4–6 weeks |

- **Cost:** 40 × 24 h = **960 engineering hours/year** on small flows ≈
  **€67,200/year** at €70/h — engineering capacity spent on work that isn't the
  product.
- **Lead time:** a business user waits **4–6 weeks** for a flow that takes an
  afternoon to build, so the automation lands late or the team just keeps doing
  the task by hand.
- **Risk:** the backlog hides the simple wins; requests get dropped, and there's
  no shared, inspectable record of what a flow actually does.

## Solution

A visual agent-workflow builder that runs **entirely in the browser** — no
backend, no build step, no install, no API key. A business user drags five kinds
of node onto a canvas (**Trigger → LLM Agent → Condition → Tool → Output**), wires
the ports, hits **Run**, and watches a mock agent walk the graph and pick tools
step by step, with a live trace. Flows save to the browser and export as JSON, so
they're shareable and reviewable. The executor is a real topological sort with
cycle detection; **the same `engine.js` runs in the browser and under the test
suite**, so what a business user sees animate is the exact code CI covers.

## Impact / ROI

Tied to what the repo really is: a working canvas whose engine is covered by
**16 passing tests**, shipping **two example flows** (RFQ triage, support-ticket
router) that run end-to-end in CI. The business value is moving simple flows off
the engineering queue to same-day self-serve.

Illustrative model (estimates):

- **Self-serviceable share:** ~70% of the 40 requests = **28 flows/year** are
  simple enough to build on the canvas.
- **Engineering time freed:** 28 × 24 h = **~672 hours/year** ≈ **€47,000/year**
  at €70/h that engineering no longer spends on small flows.
- **Lead time:** **4–6 weeks → same day** for those flows — the business user
  builds it themselves.
- **Cost to run:** effectively **zero** — it's offline, zero-dependency, and runs
  in a browser tab, so there's no licensing or infrastructure line.

**Payback.** Because there's no infra or licensing cost, the tool pays for itself
on the **first** flow a business user self-serves instead of filing a ticket.

## Stakeholders & use case

- **Business users** (support / sales / finance ops) — build and run their own
  simple flows.
- **Ops lead** — curates the shared example flows and reviews exported JSON.
- **Engineering** — keeps the complex ~30% and owns the engine; freed from the
  simple backlog.

Typical workflow:

1. A team hits a repetitive routing/triage task.
2. Instead of filing an engineering ticket, they open the canvas and drag a
   Trigger → Agent → Condition → Tool → Output flow.
3. They Run it, watch the trace, and confirm it routes correctly.
4. They export the flow JSON and share it; ops reviews it.
5. Only genuinely complex cases (retries, auth, parallel branches) go to
   engineering.

## Deliverable

Leadership receives **`deliverables/executive_onepager.pdf`** — a circulable
one-page summary of the situation, the quantified backlog cost, the self-serve
solution, and the ROI above — backed by this business case and the two runnable
example flows in `examples/`.
