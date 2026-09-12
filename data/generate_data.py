"""Synthetic FMCG P&L dataset generator.

Builds a monthly Profit & Loss dataset for a fictional mid-sized FMCG group
across four scenarios, four regional business units and five product
categories. Nothing here is real: the figures are generated from industry
benchmark ratios so that margins, cost structure and seasonality behave the
way a finance reader expects, while carrying no real or sensitive data.

Scenarios
---------
ly_actual   Prior year actuals. The historical anchor everything else is
            built from.
budget      The plan for the current year: prior year grown by a planned
            rate, phased over the months on the category seasonality curve.
            Deliberately smooth -- budgets do not contain noise.
cy_actual   Current year actuals. Budget distorted by a per-BU / per-category
            performance factor plus input cost inflation and month noise.
            Only closed months (1..LAST_CLOSED_MONTH) are meaningful; the
            open months are still generated so a full-year actual view exists
            for reference, but the dashboard should not show them.
forecast    Latest Estimate. Closed months are a verbatim copy of cy_actual;
            open months re-forecast the budget using the year-to-date run
            rate, assuming part of the YTD gap persists to year end
            (see GAP_PERSISTENCE).

Sign convention
---------------
Every value is stored as a POSITIVE magnitude. Whether a line adds to or
subtracts from the result is described by the `sign` field of each P&L line
in the metadata (+1 income, -1 cost). This keeps the fact table free of sign
juggling and leaves the arithmetic to the /js/logic layer.

Granularity
-----------
One fact per (scenario, month, business_unit, category, line). Only leaf
lines are stored -- Gross Profit, EBITDA and EBIT are subtotals and are
computed downstream from `meta.pnl_structure`, so the aggregation logic
lives in one place and stays consistent at every level of the dashboard.

Output
------
data/pnl_dataset.json   Consumed by the dashboard. `meta` is pretty printed,
                        `facts` is one compact record per line so the file
                        stays small but still diffs line by line.
data/pnl_dataset.csv    Same facts, flat, for inspection in a spreadsheet.

Deterministic: a fixed RNG seed means regenerating produces an identical
dataset, so the committed files only change when the model changes.
"""

import csv
import json
import random
from pathlib import Path

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

SEED = 20260912

CURRENT_YEAR = 2026
PRIOR_YEAR = CURRENT_YEAR - 1

# Last month closed by the finance team. Months after this one are open, so
# the Forecast scenario re-estimates them instead of copying the actuals.
LAST_CLOSED_MONTH = 8

CURRENCY = "EUR"

# Total group net revenue for the prior year, in full currency units.
ANNUAL_REVENUE_LY = 452_000_000.0

OUT_DIR = Path(__file__).resolve().parent
JSON_PATH = OUT_DIR / "pnl_dataset.json"
CSV_PATH = OUT_DIR / "pnl_dataset.csv"

MONTH_NAMES = [
    ("Jan", "January"), ("Feb", "February"), ("Mar", "March"),
    ("Apr", "April"), ("May", "May"), ("Jun", "June"),
    ("Jul", "July"), ("Aug", "August"), ("Sep", "September"),
    ("Oct", "October"), ("Nov", "November"), ("Dec", "December"),
]
MONTHS = list(range(1, 13))

# Business units. `share` is the slice of group revenue, `plan_growth` the
# growth the budget assumes over LY, `performance` how the year is actually
# going against that plan.
BUSINESS_UNITS = [
    {"id": "italy", "label": "Italy", "share": 0.32,
     "plan_growth": 0.030, "performance": -0.030},
    {"id": "iberia", "label": "Iberia", "share": 0.22,
     "plan_growth": 0.055, "performance": 0.034},
    {"id": "dach", "label": "DACH", "share": 0.28,
     "plan_growth": 0.020, "performance": -0.060},
    {"id": "nordics", "label": "Nordics", "share": 0.18,
     "plan_growth": 0.040, "performance": 0.005},
]

# Product categories. `gross_margin` is the budgeted gross margin, which is
# what drives the COGS ratio. `plan_tilt` is how much faster or slower than
# its region the plan plans this category to grow, and averages out to about
# zero across the portfolio so it adds mix to the plan without inflating
# group growth. `seasonality` is a raw 12 month shape, normalised to mean
# 1.0 at load time.
CATEGORIES = [
    {"id": "beverages", "label": "Beverages", "share": 0.28,
     "gross_margin": 0.420, "plan_tilt": 0.005, "performance": 0.012,
     "seasonality": [0.82, 0.80, 0.90, 0.98, 1.10, 1.22,
                     1.35, 1.30, 1.05, 0.92, 0.83, 0.90]},
    {"id": "snacks", "label": "Snacks", "share": 0.24,
     "gross_margin": 0.450, "plan_tilt": 0.012, "performance": 0.024,
     "seasonality": [0.94, 0.92, 0.96, 0.98, 1.00, 1.02,
                     1.04, 0.98, 1.00, 1.06, 1.12, 1.20]},
    {"id": "dairy", "label": "Dairy", "share": 0.20,
     "gross_margin": 0.320, "plan_tilt": -0.015, "performance": -0.075,
     "seasonality": [1.04, 1.02, 1.00, 0.99, 0.98, 0.96,
                     0.94, 0.92, 1.00, 1.03, 1.05, 1.09]},
    {"id": "home_care", "label": "Home Care", "share": 0.16,
     "gross_margin": 0.400, "plan_tilt": -0.008, "performance": -0.035,
     "seasonality": [0.98, 1.00, 1.08, 1.12, 1.06, 0.98,
                     0.92, 0.88, 0.98, 1.02, 1.00, 0.98]},
    {"id": "personal_care", "label": "Personal Care", "share": 0.12,
     "gross_margin": 0.520, "plan_tilt": 0.010, "performance": 0.020,
     "seasonality": [0.92, 0.90, 0.96, 0.98, 1.00, 1.02,
                     1.00, 0.94, 1.00, 1.06, 1.14, 1.28]},
]

# Deviations from a plain business unit x category outer product, so the mix
# is not identical in every region. Unlisted pairs default to 1.0. The whole
# grid is renormalised afterwards, so these are relative weights.
MIX_AFFINITY = {
    ("italy", "beverages"): 1.18,
    ("italy", "dairy"): 1.12,
    ("italy", "home_care"): 0.86,
    ("iberia", "beverages"): 1.22,
    ("iberia", "personal_care"): 0.88,
    ("dach", "home_care"): 1.24,
    ("dach", "personal_care"): 1.15,
    ("dach", "dairy"): 0.84,
    ("nordics", "snacks"): 1.16,
    ("nordics", "dairy"): 1.08,
    ("nordics", "beverages"): 0.78,
}

# Split of total COGS across its components. Must sum to 1.
COGS_MIX = {
    "cogs_materials": 0.62,
    "cogs_production": 0.24,
    "cogs_logistics": 0.14,
}

# OPEX as a share of net revenue, at budget. `variability` says how much of
# the line follows monthly volume: 1.0 fully variable, 0.0 fully fixed and
# therefore spread across the year independently of sales.
OPEX_LINES = [
    {"id": "opex_marketing", "ratio": 0.105, "variability": 0.0},
    {"id": "opex_sales", "ratio": 0.090, "variability": 1.0},
    {"id": "opex_gna", "ratio": 0.050, "variability": 0.0},
    {"id": "opex_rnd", "ratio": 0.015, "variability": 0.0},
]

# Depreciation & amortisation as a share of net revenue, spread evenly with
# a step up once new capacity comes online.
DA_RATIO = 0.035
DA_STEP_MONTH = 7      # month the new assets start depreciating
DA_STEP_UPLIFT = 0.08  # +8% monthly charge from that month on

# How the current year actually behaves against the plan, on top of the
# per-BU and per-category performance factors above.
COGS_INFLATION_DRIFT = 0.0030   # COGS ratio creep per month, compounding
MARKETING_UNDERSPEND = -0.060   # A&P discipline: 6.0% below plan
GNA_OVERSPEND = 0.045           # G&A running hot

# Share of the year-to-date gap versus budget assumed to persist into the
# remaining months when building the Latest Estimate. 1.0 would mean the run
# rate continues unchanged, 0.0 that the business snaps back to plan.
GAP_PERSISTENCE = 0.72

# Month on month noise, as a standard deviation on a multiplier of 1.0.
NOISE_REVENUE = 0.032
NOISE_COST_RATIO = 0.011

# Leaf P&L lines: (id, label, group, sign).
LEAF_LINES = [
    ("revenue", "Net Revenue", "revenue", 1),
    ("cogs_materials", "COGS - Raw & Packaging", "cogs", -1),
    ("cogs_production", "COGS - Production", "cogs", -1),
    ("cogs_logistics", "COGS - Logistics", "cogs", -1),
    ("opex_marketing", "Marketing & Advertising", "opex", -1),
    ("opex_sales", "Sales & Distribution", "opex", -1),
    ("opex_gna", "General & Administrative", "opex", -1),
    ("opex_rnd", "Research & Development", "opex", -1),
    ("d_and_a", "Depreciation & Amortisation", "d_and_a", -1),
]

# The P&L ladder the dashboard renders. `group` rows total their leaf lines,
# `subtotal` rows combine rows defined earlier in this list. Keeping the
# structure in the data means /js/logic never hardcodes the P&L shape.
PNL_STRUCTURE = [
    {"id": "revenue", "label": "Net Revenue", "type": "group",
     "components": ["revenue"], "emphasis": "strong"},
    {"id": "cogs", "label": "Cost of Goods Sold", "type": "group",
     "components": ["cogs_materials", "cogs_production", "cogs_logistics"],
     "emphasis": "normal"},
    {"id": "gross_profit", "label": "Gross Profit", "type": "subtotal",
     "formula": [["+", "revenue"], ["-", "cogs"]], "emphasis": "strong"},
    {"id": "opex", "label": "Total OPEX", "type": "group",
     "components": ["opex_marketing", "opex_sales", "opex_gna", "opex_rnd"],
     "emphasis": "normal"},
    {"id": "ebitda", "label": "EBITDA", "type": "subtotal",
     "formula": [["+", "gross_profit"], ["-", "opex"]], "emphasis": "strong"},
    {"id": "d_and_a", "label": "Depreciation & Amortisation", "type": "group",
     "components": ["d_and_a"], "emphasis": "normal"},
    {"id": "ebit", "label": "EBIT", "type": "subtotal",
     "formula": [["+", "ebitda"], ["-", "d_and_a"]], "emphasis": "strong"},
]

SCENARIOS = [
    {"id": "ly_actual", "label": "LY Actual " + str(PRIOR_YEAR),
     "year": PRIOR_YEAR},
    {"id": "budget", "label": "Budget " + str(CURRENT_YEAR),
     "year": CURRENT_YEAR},
    {"id": "cy_actual", "label": "Actual " + str(CURRENT_YEAR),
     "year": CURRENT_YEAR},
    {"id": "forecast", "label": "Forecast " + str(CURRENT_YEAR),
     "year": CURRENT_YEAR},
]


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def normalise(values):
    """Rescale a list so that its mean is exactly 1.0."""
    mean = sum(values) / len(values)
    return [v / mean for v in values]


def campaign_curve(seasonality):
    """Marketing phasing: spend leads the sales peak by about a month.

    Blended with a flat baseline because part of the A&P budget is always-on
    rather than campaign driven.
    """
    led = [seasonality[(i + 1) % 12] for i in range(12)]
    return normalise([0.40 + 0.60 * v for v in led])


def da_curve():
    """Monthly D&A weights: flat, with a step up once new assets go live."""
    raw = [1.0 if m < DA_STEP_MONTH else 1.0 + DA_STEP_UPLIFT for m in MONTHS]
    return normalise(raw)


def build_mix():
    """Revenue weight per (business unit, category), summing to 1.0."""
    grid = {}
    for bu in BUSINESS_UNITS:
        for cat in CATEGORIES:
            weight = bu["share"] * cat["share"]
            weight *= MIX_AFFINITY.get((bu["id"], cat["id"]), 1.0)
            grid[(bu["id"], cat["id"])] = weight
    total = sum(grid.values())
    return {k: v / total for k, v in grid.items()}


def cogs_ratio_for(cat):
    """Budgeted COGS as a share of net revenue."""
    return 1.0 - cat["gross_margin"]


# --------------------------------------------------------------------------
# Revenue generation
# --------------------------------------------------------------------------

def revenue_ly(rng, mix, seasonality):
    """Prior year monthly revenue per business unit and category."""
    out = {}
    for bu in BUSINESS_UNITS:
        for cat in CATEGORIES:
            annual = ANNUAL_REVENUE_LY * mix[(bu["id"], cat["id"])]
            curve = seasonality[cat["id"]]
            for m in MONTHS:
                noise = rng.gauss(1.0, NOISE_REVENUE)
                value = annual / 12.0 * curve[m - 1] * noise
                out[(bu["id"], cat["id"], m)] = max(value, 0.0)
    return out


def revenue_budget(ly, seasonality):
    """Budget revenue: LY grown by the plan, rephased, no noise.

    The budget is built on the full year LY total and then phased on the
    clean seasonality curve, which is why it comes out smooth: planners phase
    a target, they do not replay last year monthly wobble.
    """
    out = {}
    for bu in BUSINESS_UNITS:
        for cat in CATEGORIES:
            ly_annual = sum(ly[(bu["id"], cat["id"], m)] for m in MONTHS)
            annual = (ly_annual * (1.0 + bu["plan_growth"])
                      * (1.0 + cat["plan_tilt"]))
            curve = seasonality[cat["id"]]
            for m in MONTHS:
                out[(bu["id"], cat["id"], m)] = annual / 12.0 * curve[m - 1]
    return out


def revenue_actual(rng, budget):
    """Current year actual revenue: budget distorted by performance.

    The performance gap widens through the year rather than appearing in full
    in January, which is how a trading gap normally builds.
    """
    out = {}
    for bu in BUSINESS_UNITS:
        for cat in CATEGORIES:
            gap = bu["performance"] + cat["performance"]
            for m in MONTHS:
                ramp = 0.60 + 0.40 * (m / 12.0)
                noise = rng.gauss(1.0, NOISE_REVENUE)
                factor = (1.0 + gap * ramp) * noise
                out[(bu["id"], cat["id"], m)] = max(
                    budget[(bu["id"], cat["id"], m)] * factor, 0.0)
    return out


def revenue_forecast(budget, actual):
    """Latest Estimate revenue: actuals to date, re-forecast beyond.

    Open months are the budget adjusted by the year-to-date performance
    ratio, damped by GAP_PERSISTENCE so the forecast neither assumes the run
    rate holds perfectly nor that the business returns straight to plan.
    """
    out = {}
    for bu in BUSINESS_UNITS:
        for cat in CATEGORIES:
            key = (bu["id"], cat["id"])
            ytd_actual = sum(actual[(key[0], key[1], m)]
                             for m in MONTHS if m <= LAST_CLOSED_MONTH)
            ytd_budget = sum(budget[(key[0], key[1], m)]
                             for m in MONTHS if m <= LAST_CLOSED_MONTH)
            ratio = ytd_actual / ytd_budget if ytd_budget else 1.0
            carried = 1.0 + (ratio - 1.0) * GAP_PERSISTENCE
            for m in MONTHS:
                cell = (key[0], key[1], m)
                if m <= LAST_CLOSED_MONTH:
                    out[cell] = actual[cell]
                else:
                    out[cell] = budget[cell] * carried
    return out


# --------------------------------------------------------------------------
# Cost generation
# --------------------------------------------------------------------------

def cost_facts(rng, scenario_id, revenue, campaigns, da_weights):
    """Derive every cost line from a scenario revenue.

    Variable lines follow the month revenue. Fixed lines are budgeted as a
    share of the scenario own full year revenue and then spread across the
    months, so they do not inherit the seasonality of sales -- which is what
    makes monthly margin move for reasons other than mix.
    """
    inflated = scenario_id in ("cy_actual", "forecast")
    facts = []

    for bu in BUSINESS_UNITS:
        for cat in CATEGORIES:
            key = (bu["id"], cat["id"])
            annual_revenue = sum(revenue[(key[0], key[1], m)] for m in MONTHS)
            base_cogs_ratio = cogs_ratio_for(cat)

            for m in MONTHS:
                month_revenue = revenue[(key[0], key[1], m)]

                # --- COGS -------------------------------------------------
                ratio = base_cogs_ratio
                if inflated:
                    ratio *= (1.0 + COGS_INFLATION_DRIFT) ** (m - 1)
                    ratio *= rng.gauss(1.0, NOISE_COST_RATIO)
                cogs_total = month_revenue * ratio
                for line_id, weight in COGS_MIX.items():
                    facts.append((line_id, m, key, cogs_total * weight))

                # --- OPEX -------------------------------------------------
                for line in OPEX_LINES:
                    line_ratio = line["ratio"]
                    if inflated and line["id"] == "opex_marketing":
                        line_ratio *= (1.0 + MARKETING_UNDERSPEND)
                    if inflated and line["id"] == "opex_gna":
                        line_ratio *= (1.0 + GNA_OVERSPEND)

                    variable = month_revenue * line_ratio
                    if line["id"] == "opex_marketing":
                        # A&P is phased on the campaign calendar, not on sales
                        fixed = (annual_revenue * line_ratio
                                 * campaigns[cat["id"]][m - 1] / 12.0)
                    else:
                        fixed = annual_revenue * line_ratio / 12.0

                    v = line["variability"]
                    value = v * variable + (1.0 - v) * fixed
                    if inflated:
                        value *= rng.gauss(1.0, NOISE_COST_RATIO)
                    facts.append((line["id"], m, key, value))

                # --- D&A --------------------------------------------------
                da = annual_revenue * DA_RATIO * da_weights[m - 1] / 12.0
                facts.append(("d_and_a", m, key, da))

    return facts


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------

def build_facts(rng):
    seasonality = {c["id"]: normalise(c["seasonality"]) for c in CATEGORIES}
    campaigns = {c["id"]: campaign_curve(seasonality[c["id"]])
                 for c in CATEGORIES}
    da_weights = da_curve()
    mix = build_mix()

    ly = revenue_ly(rng, mix, seasonality)
    budget = revenue_budget(ly, seasonality)
    actual = revenue_actual(rng, budget)
    forecast = revenue_forecast(budget, actual)

    revenues = {
        "ly_actual": ly,
        "budget": budget,
        "cy_actual": actual,
        "forecast": forecast,
    }

    rows = []
    per_scenario_costs = {}
    for scenario_id, revenue in revenues.items():
        for (bu_id, cat_id, m), value in revenue.items():
            rows.append({
                "scenario": scenario_id, "month": m, "business_unit": bu_id,
                "category": cat_id, "line": "revenue",
                "value": round(value, 2),
            })
        per_scenario_costs[scenario_id] = cost_facts(
            rng, scenario_id, revenue, campaigns, da_weights)

    # Closed months of the Latest Estimate are the actuals, cost lines
    # included -- a forecast never restates a month that is already booked.
    actual_lookup = {
        (line_id, m, key): value
        for line_id, m, key, value in per_scenario_costs["cy_actual"]
    }
    per_scenario_costs["forecast"] = [
        (line_id, m, key,
         actual_lookup[(line_id, m, key)] if m <= LAST_CLOSED_MONTH else value)
        for line_id, m, key, value in per_scenario_costs["forecast"]
    ]

    for scenario_id, costs in per_scenario_costs.items():
        for line_id, m, key, value in costs:
            rows.append({
                "scenario": scenario_id, "month": m, "business_unit": key[0],
                "category": key[1], "line": line_id,
                "value": round(value, 2),
            })

    line_order = {line[0]: i for i, line in enumerate(LEAF_LINES)}
    scenario_order = {s["id"]: i for i, s in enumerate(SCENARIOS)}
    bu_order = {b["id"]: i for i, b in enumerate(BUSINESS_UNITS)}
    cat_order = {c["id"]: i for i, c in enumerate(CATEGORIES)}
    rows.sort(key=lambda r: (
        scenario_order[r["scenario"]], r["month"], bu_order[r["business_unit"]],
        cat_order[r["category"]], line_order[r["line"]],
    ))
    return rows


def build_meta():
    return {
        "description": (
            "Synthetic FMCG P&L dataset. No real or sensitive data: figures "
            "are generated from industry benchmark ratios."
        ),
        "currency": CURRENCY,
        "unit": "full currency units",
        "current_year": CURRENT_YEAR,
        "prior_year": PRIOR_YEAR,
        "last_closed_month": LAST_CLOSED_MONTH,
        "value_convention": (
            "All values are positive magnitudes; use pnl_lines[].sign to know "
            "whether a line adds to or subtracts from the result."
        ),
        "scenarios": SCENARIOS,
        "months": [{"n": m, "short": MONTH_NAMES[m - 1][0],
                    "label": MONTH_NAMES[m - 1][1]} for m in MONTHS],
        "business_units": [{"id": b["id"], "label": b["label"]}
                           for b in BUSINESS_UNITS],
        "categories": [{"id": c["id"], "label": c["label"]}
                       for c in CATEGORIES],
        "pnl_lines": [{"id": i, "label": l, "group": g, "sign": s}
                      for i, l, g, s in LEAF_LINES],
        "pnl_structure": PNL_STRUCTURE,
    }


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------

def write_json(path, meta, facts):
    """Pretty metadata, one compact fact per line: small file, readable diff."""
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write("{\n")
        f.write('"meta": ')
        f.write(json.dumps(meta, ensure_ascii=False, indent=2))
        f.write(",\n")
        f.write('"facts": [\n')
        last = len(facts) - 1
        for i, fact in enumerate(facts):
            f.write(json.dumps(fact, ensure_ascii=False,
                               separators=(",", ":")))
            f.write(",\n" if i < last else "\n")
        f.write("]\n}\n")


def write_csv(path, facts):
    fields = ["scenario", "month", "business_unit", "category", "line", "value"]
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(facts)


# --------------------------------------------------------------------------
# Validation and reporting
# --------------------------------------------------------------------------

def pnl_totals(facts, scenario_id, through_month=12):
    """Full company P&L for one scenario, as a dict of line id -> value."""
    groups = {"revenue": 0.0, "cogs": 0.0, "opex": 0.0, "d_and_a": 0.0}
    line_group = {i: g for i, _, g, _ in LEAF_LINES}
    for fact in facts:
        if fact["scenario"] != scenario_id or fact["month"] > through_month:
            continue
        groups[line_group[fact["line"]]] += fact["value"]
    groups["gross_profit"] = groups["revenue"] - groups["cogs"]
    groups["ebitda"] = groups["gross_profit"] - groups["opex"]
    groups["ebit"] = groups["ebitda"] - groups["d_and_a"]
    return groups


def validate(facts):
    """Fail loudly if the generated numbers leave FMCG plausibility."""
    for fact in facts:
        if fact["value"] < 0:
            raise ValueError("negative value generated: " + repr(fact))

    for scenario in SCENARIOS:
        t = pnl_totals(facts, scenario["id"])
        gm = t["gross_profit"] / t["revenue"]
        ebitda = t["ebitda"] / t["revenue"]
        if not 0.30 <= gm <= 0.50:
            raise ValueError(
                "{}: gross margin {:.1%} outside 30-50%".format(
                    scenario["id"], gm))
        if not 0.06 <= ebitda <= 0.25:
            raise ValueError(
                "{}: EBITDA margin {:.1%} outside 6-25%".format(
                    scenario["id"], ebitda))

    # The Latest Estimate must not restate a closed month.
    actual = {(f["month"], f["business_unit"], f["category"], f["line"]):
              f["value"] for f in facts if f["scenario"] == "cy_actual"}
    for f in facts:
        if f["scenario"] != "forecast" or f["month"] > LAST_CLOSED_MONTH:
            continue
        key = (f["month"], f["business_unit"], f["category"], f["line"])
        if abs(actual[key] - f["value"]) > 0.01:
            raise ValueError("forecast restates closed month: " + repr(key))


def report(facts):
    rows = [
        ("Net Revenue", "revenue"), ("COGS", "cogs"),
        ("Gross Profit", "gross_profit"), ("Total OPEX", "opex"),
        ("EBITDA", "ebitda"), ("D&A", "d_and_a"), ("EBIT", "ebit"),
    ]
    totals = {s["id"]: pnl_totals(facts, s["id"]) for s in SCENARIOS}

    print("\nFull year P&L by scenario (" + CURRENCY + " m, % of net revenue)\n")
    header = "{:<16}".format("") + "".join(
        "{:>20}".format(s["label"]) for s in SCENARIOS)
    print(header)
    print("-" * len(header))
    for label, key in rows:
        line = "{:<16}".format(label)
        for s in SCENARIOS:
            t = totals[s["id"]]
            line += "{:>12,.1f}{:>8.1%}".format(
                t[key] / 1e6, t[key] / t["revenue"])
        print(line)

    ytd = {s["id"]: pnl_totals(facts, s["id"], LAST_CLOSED_MONTH)
           for s in SCENARIOS}
    var = ytd["cy_actual"]["revenue"] / ytd["budget"]["revenue"] - 1.0
    print("\nYTD (Jan-{}) revenue vs budget: {:+.1%}".format(
        MONTH_NAMES[LAST_CLOSED_MONTH - 1][0], var))
    fy = totals["forecast"]["revenue"] / totals["budget"]["revenue"] - 1.0
    print("Full year forecast vs budget:  {:+.1%}".format(fy))


def main():
    rng = random.Random(SEED)
    facts = build_facts(rng)
    meta = build_meta()

    validate(facts)
    write_json(JSON_PATH, meta, facts)
    write_csv(CSV_PATH, facts)

    print("Generated {:,} facts".format(len(facts)))
    print("  {}  {:,.0f} KB".format(
        JSON_PATH.name, JSON_PATH.stat().st_size / 1024))
    print("  {}  {:,.0f} KB".format(
        CSV_PATH.name, CSV_PATH.stat().st_size / 1024))
    report(facts)


if __name__ == "__main__":
    main()
