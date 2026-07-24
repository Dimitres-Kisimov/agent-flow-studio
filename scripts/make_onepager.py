"""make_onepager.py — render the executive one-pager leadership can circulate.

Produces `deliverables/executive_onepager.pdf` (two pages, matplotlib PdfPages):

    page 1  the business case on a page — situation, quantified problem,
            solution, ROI and a recommendation.
    page 2  how the numbers were derived (assumptions) and the real repo facts
            the case rests on.

This is a build-time tooling script, deliberately kept OUTSIDE the shipped app:
the app itself is still zero-dependency HTML/CSS/JS and needs nothing to run.
Rendering the PDF is the only thing that needs Python + matplotlib:

    pip install matplotlib
    python scripts/make_onepager.py

The repo facts on page 2 (example-flow count) are read from ../examples so the
one-pager can't drift from what actually ships. Cost figures are an illustrative
model and are labelled as estimates — see docs/BUSINESS_CASE.md.

Author: Dimitres Kisimov.
"""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.backends.backend_pdf import PdfPages  # noqa: E402
from matplotlib.patches import FancyBboxPatch, Rectangle  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples"
OUT = ROOT / "deliverables" / "executive_onepager.pdf"

INK = "#1b1f24"
MUTE = "#5b6470"
BLUE = "#3d7df0"
PURPLE = "#7c5cff"
GREEN = "#1d9e6f"
PINK = "#ea4b71"
BAND = "#eef3fd"

# --- inputs: assumptions (estimates) + real repo facts -----------------------
REQUESTS_YEAR = 40
HOURS_EACH = 24
RATE_EUR_H = 70
SELF_SERVE = 0.70
WEEKS_WAIT = "4–6 weeks"

COST_YEAR = REQUESTS_YEAR * HOURS_EACH * RATE_EUR_H
SELF_COUNT = round(REQUESTS_YEAR * SELF_SERVE)
HOURS_FREED = SELF_COUNT * HOURS_EACH
COST_FREED = HOURS_FREED * RATE_EUR_H

TESTS = 16
NODE_TYPES = 5


def _n_examples() -> int:
    if EXAMPLES.exists():
        return len(list(EXAMPLES.glob("*.json")))
    return 2


def _band(fig, y, h, color=BAND):
    fig.patches.append(Rectangle((0, y), 1, h, transform=fig.transFigure,
                                 facecolor=color, edgecolor="none", zorder=0))


def _stat(fig, x, y, big, label, color, size=21):
    fig.text(x, y, big, fontsize=size, fontweight="bold", color=color,
             ha="left", va="baseline")
    fig.text(x, y - 0.026, label, fontsize=7.6, color=MUTE, ha="left", va="top")


def _card(fig, x, y, w, h, color):
    fig.patches.append(FancyBboxPatch(
        (x, y), w, h, transform=fig.transFigure,
        boxstyle="round,pad=0.006,rounding_size=0.012",
        facecolor="white", edgecolor=color, linewidth=1.3, zorder=1))


def page_one(pdf, n_examples):
    fig = plt.figure(figsize=(8.27, 11.69))  # A4 portrait
    _band(fig, 0.902, 0.098, PURPLE)
    fig.text(0.06, 0.955, "Executive one-pager", fontsize=11, color="white",
             fontweight="bold", ha="left")
    fig.text(0.06, 0.925, "A self-serve canvas for simple AI automations",
             fontsize=17, color="white", fontweight="bold", ha="left")
    fig.text(0.94, 0.923, "agent-flow-studio", fontsize=9, color="#e2dbff",
             ha="right")

    fig.text(0.06, 0.878, "Situation", fontsize=12, color=INK, fontweight="bold")
    fig.text(0.06, 0.860,
             "Meridian Services Group (illustrative mid-size B2B services company) has an ops team\n"
             "that keeps getting the same shape of request — route these tickets, triage these emails,\n"
             "escalate anything urgent. Each is a small automation, and every one is a ticket in the\n"
             "engineering backlog, because business users can't assemble one themselves.",
             fontsize=9.3, color=MUTE, va="top", linespacing=1.55)

    _band(fig, 0.688, 0.092, "#fdeef2")
    fig.text(0.06, 0.766, "The problem, in numbers", fontsize=12, color=PINK,
             fontweight="bold")
    _stat(fig, 0.07, 0.726, f"{REQUESTS_YEAR}", "small-automation requests\n/ year to engineering", PINK)
    _stat(fig, 0.30, 0.726, f"€{COST_YEAR/1000:.0f}k", "engineering time / year\non small flows (estimate)", PINK)
    _stat(fig, 0.53, 0.726, "4–6 wk", "typical queue wait\nbefore work starts", PINK, size=18)
    _stat(fig, 0.74, 0.726, "backlog", "simple wins hidden\nbehind product work", PINK, size=17)

    fig.text(0.06, 0.648, "Solution", fontsize=12, color=INK, fontweight="bold")
    fig.text(0.06, 0.630,
             "A visual agent-workflow builder that runs entirely in the browser — no backend, no build\n"
             "step, no install, no API key. A business user drags five node types, wires them, hits Run,\n"
             "and watches a live trace. The same engine.js runs in the browser and under the tests.",
             fontsize=9.3, color=MUTE, va="top", linespacing=1.55)

    # node-type strip
    steps = ["Trigger", "LLM Agent", "Condition", "Tool", "Output"]
    x0, w, gap = 0.06, 0.158, 0.012
    for i, s in enumerate(steps):
        x = x0 + i * (w + gap)
        fig.patches.append(FancyBboxPatch(
            (x, 0.545), w, 0.030, transform=fig.transFigure,
            boxstyle="round,pad=0.004,rounding_size=0.01",
            facecolor="white", edgecolor=PURPLE, linewidth=1.1))
        fig.text(x + w / 2, 0.560, s, fontsize=7.8, color=INK, ha="center", va="center")
    fig.text(0.06, 0.523,
             f"{NODE_TYPES} node types, a real topological-sort executor, and "
             f"{n_examples} example flows that run end-to-end in CI.",
             fontsize=8, color=MUTE, style="italic")

    _band(fig, 0.300, 0.185, "#eafaf3")
    fig.text(0.06, 0.462, "Impact / ROI", fontsize=12, color=GREEN, fontweight="bold")
    fig.text(0.06, 0.444,
             "Illustrative model: move the simple flows off the engineering queue to same-day\n"
             "self-serve. Keep engineering for the genuinely complex ~30%.",
             fontsize=9, color=MUTE, va="top", linespacing=1.55)
    _stat(fig, 0.07, 0.383, f"{SELF_COUNT}/yr", "flows a business user\nself-serves (~70%)", GREEN)
    _stat(fig, 0.30, 0.383, f"{HOURS_FREED} h", "engineering hours\nfreed / year", GREEN)
    _stat(fig, 0.53, 0.383, f"€{COST_FREED/1000:.0f}k", "engineering cost\nfreed / year (est.)", GREEN)
    _stat(fig, 0.74, 0.383, "same-day", "lead time, down from\n4–6 weeks", GREEN, size=17)

    _card(fig, 0.06, 0.135, 0.88, 0.115, PURPLE)
    fig.text(0.08, 0.222, "Recommendation", fontsize=11, color=PURPLE, fontweight="bold")
    fig.text(0.08, 0.203,
             "Use the canvas as a self-serve intake for simple flows and keep engineering for the\n"
             "complex 30%. This repo is the working proof-of-concept of the pattern; a production\n"
             "rollout would put a real model behind the agent node and add auth and retries.",
             fontsize=9, color=INK, va="top", linespacing=1.55)

    fig.text(0.06, 0.055,
             "Cost figures are an illustrative model, labelled as estimates.",
             fontsize=7.2, color=MUTE, ha="left")
    fig.text(0.94, 0.055, "Dimitres Kisimov · page 1 / 2", fontsize=7.2,
             color=MUTE, ha="right")
    pdf.savefig(fig)
    plt.close(fig)


def page_two(pdf, n_examples):
    fig = plt.figure(figsize=(8.27, 11.69))
    _band(fig, 0.902, 0.098, "#39424f")
    fig.text(0.06, 0.94, "How the numbers were derived", fontsize=17,
             color="white", fontweight="bold", ha="left")

    fig.text(0.06, 0.855, "Assumptions (estimates)", fontsize=12, color=INK,
             fontweight="bold")
    rows = [
        ("Small-automation requests per year", f"{REQUESTS_YEAR}"),
        ("Engineering effort each (build + review + deploy)", f"{HOURS_EACH} h"),
        ("Fully-loaded engineer cost", f"€{RATE_EUR_H} / hour"),
        ("Share simple enough to self-serve", f"{SELF_SERVE*100:.0f}%"),
        ("Typical queue wait before work starts", WEEKS_WAIT),
    ]
    y = 0.828
    for i, (k, v) in enumerate(rows):
        if i % 2 == 0:
            fig.patches.append(Rectangle((0.06, y - 0.006), 0.88, 0.03,
                               transform=fig.transFigure, facecolor="#f2f5fa",
                               edgecolor="none"))
        fig.text(0.08, y + 0.006, k, fontsize=9.3, color=INK, va="center")
        fig.text(0.92, y + 0.006, v, fontsize=9.3, color=INK, va="center", ha="right",
                 fontweight="bold")
        y -= 0.032

    fig.text(0.06, 0.63, "The arithmetic", fontsize=12, color=INK, fontweight="bold")
    calc = [
        f"Eng. hours/year  = {REQUESTS_YEAR} × {HOURS_EACH} h  =  {REQUESTS_YEAR*HOURS_EACH} h",
        f"Eng. cost/year   = {REQUESTS_YEAR*HOURS_EACH} h × €{RATE_EUR_H}  =  €{COST_YEAR:,}",
        f"Self-served/year = {REQUESTS_YEAR} × {SELF_SERVE*100:.0f}%  =  {SELF_COUNT} flows",
        f"Hours freed/year = {SELF_COUNT} × {HOURS_EACH} h  =  {HOURS_FREED} h",
        f"Cost freed/year  = {HOURS_FREED} h × €{RATE_EUR_H}  =  €{COST_FREED:,}",
        "Payback          = no infra / licensing cost  ->  first self-served flow",
    ]
    y = 0.602
    for line in calc:
        fig.text(0.08, y, line, fontsize=9.2, color=MUTE, family="monospace")
        y -= 0.03

    fig.text(0.06, 0.39, "Real repo facts (not estimated)", fontsize=12,
             color=GREEN, fontweight="bold")
    fig.text(0.08, 0.365,
             f"What the ROI rests on — the working proof-of-concept:\n"
             f"  •  {TESTS} passing engine tests (node --test), pure Node built-ins, no dependencies\n"
             f"  •  {NODE_TYPES} node types on a browser canvas: Trigger, LLM Agent, Condition, Tool, Output\n"
             f"  •  a real topological-sort executor (Kahn's algorithm) with cycle detection\n"
             f"  •  {n_examples} example flows (RFQ triage, support-ticket router) that run end-to-end in CI\n"
             f"  •  the same engine.js runs in the browser and under the tests",
             fontsize=9.2, color=MUTE, va="top", linespacing=1.6)

    _card(fig, 0.06, 0.11, 0.88, 0.1, PURPLE)
    fig.text(0.08, 0.185, "Read more", fontsize=11, color=PURPLE, fontweight="bold")
    fig.text(0.08, 0.167,
             "•  docs/BUSINESS_CASE.md   —  the full one-page business case\n"
             "•  examples/   —  two runnable example flows\n"
             "•  README.md   —  what it is and how to run it offline",
             fontsize=9, color=INK, va="top", linespacing=1.7)

    fig.text(0.94, 0.055, "Dimitres Kisimov · page 2 / 2", fontsize=7.2,
             color=MUTE, ha="right")
    pdf.savefig(fig)
    plt.close(fig)


def main() -> int:
    n_examples = _n_examples()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with PdfPages(OUT) as pdf:
        page_one(pdf, n_examples)
        page_two(pdf, n_examples)
    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"  headline: ~€{COST_FREED/1000:.0f}k / {HOURS_FREED} h of engineering "
          f"freed per year, weeks -> same-day lead time (estimates)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
