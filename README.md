# FMCG P&L Dashboard

A profit and loss dashboard for a fictional Italian FMCG group, built as
plain HTML, CSS and JavaScript on a synthetic dataset. No BI tool, no
framework, no build step.

**[Open the dashboard →](https://nicolacavalli02.github.io/fmcg-pnl-dashboard/)**

---

## Why this exists

Most reporting work happens inside Power BI or Tableau, where the modelling
decisions are hidden behind a drag-and-drop surface. This project makes the
same decisions in code, where they can be read, argued with and tested.

The financial value of the figures is not the point. The point is how the
P&L is constructed: what the grain of the data is, which subtotals are
derived rather than stored, where a number stops being answerable, and why a
cost that follows revenue instead of volume would quietly break the
promotional analysis.

## The data is synthetic

Everything here is generated. The company, its customers, its results and
its market do not exist. There is no real or sensitive data in this
repository. The figures are drawn from FMCG benchmark ratios so that
margins, discount structure, seasonality and cost behaviour move the way a
finance reader expects, and the whole dataset is reproducible from one
seeded script.

```bash
python3 data/generate_data.py
```

If you would rather read the dataset than the generator,
[`docs/dataset-walkthrough.xlsx`](docs/dataset-walkthrough.xlsx) takes the
current year apart in Excel: the raw fact table, one customer traced from gross
sales to contribution margin, and the full P&L rebuilt with live `SUMIFS` so
the ladder assembles in front of you. It also demonstrates the trap the logic
layer exists to avoid — filter overhead to a single customer and Excel answers
zero, where the honest answer is "not available at this grain".

## What the dataset contains

Italy only. Four scenarios — prior year actual, budget, current year actual
and latest estimate — across twelve months, twelve customers on three trade
channels, five product categories and a full commercial P&L.

| | |
|---|---|
| Facts | 38,640 (4.7 MB of JSON, ~360 KB gzipped over the wire) |
| Scenarios | LY Actual 2025, Budget 2026, Actual 2026, Forecast 2026 |
| Customers | 12, top three at 44% of the business |
| Channels | Modern Trade, Discount, Wholesale |
| Categories | Beverages, Snacks, Dairy, Home Care, Personal Care |
| Books closed through | August 2026 |

The P&L runs from gross sales rather than from net revenue, because in FMCG
the money is given away above the top line:

```
Gross Sales
  − On-invoice discounts
  − Promotional trade spend
  − Other trade spend
  − Returns and credit notes
= Net Revenue
  − COGS
= Gross Profit
  − Brand marketing, sales & distribution
= Contribution Margin
  − Unallocated overhead (G&A, R&D)
= EBITDA
  − D&A
= EBIT
```

Alongside the ladder, and deliberately outside it: volume in cases split
into baseline, incremental and sold-on-promotion; category market size at
volume and value; and the list price per case.

## What the numbers say

Full year, EUR m:

| | LY 2025 | Budget 2026 | Actual 2026 | Forecast 2026 |
|---|---:|---:|---:|---:|
| Net Revenue | 336.4 | 359.2 | 349.3 | 349.9 |
| Gross Profit | 141.4 | 152.7 | 142.8 | 143.0 |
| *Gross margin* | *42.1%* | *42.5%* | *40.9%* | *40.9%* |
| Contribution Margin | 82.6 | 91.1 | 84.3 | 84.4 |
| EBITDA | 57.0 | 63.8 | 56.9 | 56.9 |
| EBIT | 44.9 | 50.8 | 44.3 | 44.3 |

The year has a story, and every part of it is traceable to a cause in the
generator rather than to noise:

- **Revenue is 2.9% behind plan year to date**, and the gap widens through
  the year rather than appearing in January.
- **The channel mix is shifting to Discount** (+1.9% against plan while
  Modern Trade runs −5.1%) — and that shift costs margin, because Discount
  contributes 20.3% against Wholesale at 26.3%. Growing in the cheapest
  channel is not free.
- **Gross margin erodes 1.6 points against plan**, from input costs running
  above the budgeted inflation assumption and a list price increase that was
  planned for March and landed in April.
- **Promotions ran deeper than agreed**, pushing the gross-to-net ratio from
  25.8% to 26.9%.
- **Dairy loses a full point of market share** — volume down 6.2% in a flat
  market, so it is a competitiveness problem, not a demand problem.
- **Promotional ROI ranges from 0.27 in Dairy to 0.82 in Personal Care.**
  Below 1.0 a promotion gives away more margin than it earns back, so there
  is a real case to argue about where to stop investing.

## How it is built

```
data/     generator (Python, standard library only) and the dataset it emits
js/logic/ every derived calculation — no DOM, no Chart.js, importable in Node
js/charts/ one module per chart, reading only from js/logic
js/app.js page controller: loads once, fills the DOM, calls the charts
css/      styling, and the single definition of the scenario palette
```

The layering is the point. `js/logic` knows nothing about the page and is
covered by 106 self-checks that cross-reference the JavaScript results
against the Python generator's own report, so a change to either side that
breaks agreement fails loudly:

```bash
node js/logic/checks.mjs
```

## Modelling decisions worth defending

**COGS is volume times cost per case, never a percentage of revenue.** As a
ratio, granting a discount would reduce the cost of goods along with the
price, and every promotional figure downstream would be wrong.

**Volume is split three ways** — baseline, incremental, and sold on
promotion. Promotional pressure is volume on promotion over total;
promotional ROI is incremental margin over promotional spend. Collapsing
these into one measure makes one of the two unanswerable.

**Subtotals are not stored.** Gross profit, contribution margin, EBITDA and
EBIT are described by `meta.pnl_structure` in the dataset and computed in
the logic layer, so the shape of the P&L exists in exactly one place.

**The customer P&L stops at contribution margin.** G&A, R&D and D&A are held
per category with a null customer, because allocating general overhead to an
individual retailer is fake precision. Filter the dashboard to one customer
and EBITDA returns `null`, not a number — a metric that cannot be answered
at that grain says so rather than quietly reporting contribution margin
under a different name.

**The market is an independent series.** Sized once off the prior year and
then grown at its own rate. Derived from our own volume it would pin share
to a constant, and losing a category would shrink the market along with us
instead of showing up as share loss.

**The budget carries its own cost inflation assumption.** Without it the
plan would assume a price increase against flat costs, and the entire margin
variance would be an artefact of an unrealistic plan rather than a trading
result.

## Charting conventions

The actual line stops at the last closed month. The generator does produce
current year figures for the open months, but drawing them would show
numbers the business does not have yet; beyond the close only the latest
estimate has anything to say, and it is always dashed so it reads as
provisional even in greyscale.

The scenario palette is defined once, as custom properties in
`css/style.css`, and chart modules read it at render time. No chart carries
a colour value of its own, and light and dark themes stay in step.

| Scenario | Treatment |
|---|---|
| Actual | Deep teal, solid, heaviest — the subject |
| Forecast | Same family one step lighter, **always dashed** |
| Budget | Ochre, the only warm tone, so plan and actual never blur |
| LY Actual | Neutral grey — context, never the subject |

## Running it locally

The dataset is loaded with `fetch`, so opening `index.html` from the
filesystem will fail on CORS. Serve the directory:

```bash
python3 -m http.server
```

Then open the address it prints. There is nothing to install and nothing to
build.

## Stack

Vanilla HTML, CSS and JavaScript with ES modules. Chart.js from a CDN for
rendering. Python standard library for the generator. No dependencies, no
package manager, no build step — `package.json` exists only to declare
`"type": "module"` so Node can run the checks.
