"""Synthetic FMCG P&L dataset generator.

Builds a monthly Profit & Loss for a fictional mid-sized Italian FMCG group,
from gross sales down to EBIT, across four scenarios, twelve customers on
three trade channels and five product categories. Nothing here is real: the
figures are generated from industry benchmark ratios so that price, discount
structure, margins and seasonality behave the way a finance reader expects,
while carrying no real or sensitive data.

What makes this dataset worth building
--------------------------------------
Volume is modelled first and value is derived from it. Cases are priced at a
list price, discounts are taken off that price, and COGS is cases times a
cost per case -- never a percentage of revenue. That ordering matters: if
COGS were a share of revenue, granting a discount would magically reduce the
cost of goods and every promotional calculation downstream would be wrong.

Volume is split three ways so that both promotional questions are separately
answerable:
  volume_baseline     what would have sold with no promotion
  volume_incremental  the extra cases the promotion generated
  volume_on_promo     cases sold under promotional terms, which includes
                      baseline cases that would have sold anyway
Total volume is baseline + incremental. Promotional pressure is
volume_on_promo over total; promotional ROI is incremental margin over
promotional trade spend. Collapsing these into one measure would make one of
the two unanswerable.

Scenarios
---------
ly_actual   Prior year actuals. The historical anchor everything else is
            built from.
budget      The plan for the current year: prior year volume grown by a
            planned rate and phased on the category seasonality curve.
            Deliberately smooth -- budgets do not contain noise.
cy_actual   Current year actuals. Budget distorted by a per-channel and
            per-category performance gap that widens through the year, a
            list price increase that landed a month later than planned,
            deeper promotions than agreed, and input cost inflation.
forecast    Latest Estimate. Closed months are a verbatim copy of cy_actual;
            open months re-forecast the budget on the year-to-date run rate,
            damped by GAP_PERSISTENCE.

Grain and allocation
--------------------
The customer P&L stops at contribution margin. Everything from gross sales
down to Sales & Distribution is held per customer and category; G&A, R&D and
D&A are held per category only, with a null customer, because allocating
general overhead to an individual retailer is fake precision. A customer
view therefore reads down to contribution margin, and EBITDA and EBIT exist
only once the unallocated lines are added back at group level. Metadata
flags which rows of the ladder are available at customer grain.

Sign convention
---------------
Every value is stored as a POSITIVE magnitude. Whether a line adds to or
subtracts from the result is described by the `sign` field of each P&L line
in the metadata (+1 income, -1 cost, 0 for statistical lines such as volume
and market size, which are not part of the ladder). Subtotals are not
stored: they are described by `meta.pnl_structure` and computed in
/js/logic, so the P&L shape is never hardcoded in a chart.

No derived KPIs are stored. Promotional pressure, gross-to-net ratio, trade
spend efficiency, promo ROI, market share and the price/volume/mix bridge
are all computable from the base measures below, so the dashboard can decide
what to show without the dataset being regenerated.

Output
------
data/pnl_dataset.json   Consumed by the dashboard. `meta` is pretty printed,
                        each fact is one compact line so the file stays small
                        but still diffs line by line.
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

COUNTRY = "Italy"
CURRENCY = "EUR"
VOLUME_UNIT = "cases"

# Total group volume for the prior year, in cases.
TOTAL_VOLUME_LY = 15_200_000.0

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

# Trade channels. Each one is a different commercial model, which is the
# whole point of splitting them:
#   price_index          gross price per case relative to Modern Trade
#   discount_on_invoice  logistic, financial and quantity discounts, as a
#                        share of gross sales
#   trade_other          off-invoice money that is not promotional: listing
#                        fees, year-end bonuses
#   returns              returns and credit notes
#   promo_volume_share   share of cases sold under promotional terms
#   promo_depth          average discount granted on those cases
#   incremental_base     share of total volume the promotions actually create
#   cost_to_serve        Sales & Distribution cost per case
CHANNELS = [
    {"id": "modern_trade", "label": "Modern Trade",
     "price_index": 1.00, "discount_on_invoice": 0.060,
     "trade_other": 0.035, "returns": 0.008,
     "promo_volume_share": 0.38, "promo_depth": 0.32,
     "incremental_base": 0.22, "cost_to_serve": 2.30,
     "plan_growth": 0.015, "performance": -0.035},
    {"id": "discount", "label": "Discount",
     "price_index": 0.84, "discount_on_invoice": 0.110,
     "trade_other": 0.010, "returns": 0.005,
     "promo_volume_share": 0.12, "promo_depth": 0.28,
     "incremental_base": 0.06, "cost_to_serve": 1.85,
     "plan_growth": 0.055, "performance": 0.040},
    {"id": "wholesale", "label": "Wholesale",
     "price_index": 0.92, "discount_on_invoice": 0.140,
     "trade_other": 0.010, "returns": 0.006,
     "promo_volume_share": 0.18, "promo_depth": 0.25,
     "incremental_base": 0.10, "cost_to_serve": 1.20,
     "plan_growth": 0.020, "performance": -0.015},
]

# Customers. `share` is the slice of group volume; the top three add up to
# roughly 44%, which is the concentration a mid-sized Italian FMCG supplier
# actually faces. `area` is a plain attribute, not a dimension of the fact
# table -- it gives a territorial cut for free without multiplying rows.
CUSTOMERS = [
    {"id": "ipervia", "label": "IperVia", "channel": "modern_trade",
     "area": "National", "share": 0.180},
    {"id": "coopnord", "label": "CoopNord", "channel": "modern_trade",
     "area": "North-East", "share": 0.110},
    {"id": "superconti", "label": "Superconti", "channel": "modern_trade",
     "area": "North-West", "share": 0.100},
    {"id": "mercatopiu", "label": "MercatoPiu", "channel": "modern_trade",
     "area": "Centre", "share": 0.080},
    {"id": "casaspesa", "label": "CasaSpesa", "channel": "modern_trade",
     "area": "South & Islands", "share": 0.050},
    {"id": "prezzonet", "label": "PrezzoNet", "channel": "discount",
     "area": "National", "share": 0.150},
    {"id": "eurospesa", "label": "Eurospesa", "channel": "discount",
     "area": "National", "share": 0.085},
    {"id": "bassocosto", "label": "BassoCosto", "channel": "discount",
     "area": "North-West", "share": 0.050},
    {"id": "risparmiosud", "label": "RisparmioSud", "channel": "discount",
     "area": "South & Islands", "share": 0.035},
    {"id": "grossocentro", "label": "GrossoCentro", "channel": "wholesale",
     "area": "Centre", "share": 0.068},
    {"id": "adriatica", "label": "Adriatica Distribuzione",
     "channel": "wholesale", "area": "North-East", "share": 0.052},
    {"id": "sicilgross", "label": "Sicilgross", "channel": "wholesale",
     "area": "South & Islands", "share": 0.040},
]

# Product categories.
#   list_price          gross price per case at Modern Trade, prior year
#   target_gross_margin drives the cost per case (see cost_per_case)
#   promo_elasticity    how well the category responds to promotion, and so
#                       how much incremental volume the spend buys
#   promo_participation how promotable the category is, against the channel
#   market_share        our share of the category market in the prior
#                       year, used once to size the market
#   market_growth_*     how the market itself moves, independently of
#                       our own performance
#   plan_tilt           how much faster than its channel the plan grows it
#   performance         how the year is actually going against that plan
CATEGORIES = [
    {"id": "beverages", "label": "Beverages", "share": 0.28,
     "list_price": 24.00, "target_gross_margin": 0.420,
     "promo_elasticity": 1.30, "promo_participation": 1.15,
     "market_share": 0.142,
     "market_growth_plan": 0.025, "market_growth_actual": 0.022, "plan_tilt": 0.005, "performance": 0.012,
     "seasonality": [0.82, 0.80, 0.90, 0.98, 1.10, 1.22,
                     1.35, 1.30, 1.05, 0.92, 0.83, 0.90]},
    {"id": "snacks", "label": "Snacks", "share": 0.24,
     "list_price": 32.00, "target_gross_margin": 0.450,
     "promo_elasticity": 1.15, "promo_participation": 1.05,
     "market_share": 0.118,
     "market_growth_plan": 0.035, "market_growth_actual": 0.040, "plan_tilt": 0.012, "performance": 0.024,
     "seasonality": [0.94, 0.92, 0.96, 0.98, 1.00, 1.02,
                     1.04, 0.98, 1.00, 1.06, 1.12, 1.20]},
    {"id": "dairy", "label": "Dairy", "share": 0.20,
     "list_price": 28.00, "target_gross_margin": 0.320,
     "promo_elasticity": 0.60, "promo_participation": 0.90,
     "market_share": 0.165,
     "market_growth_plan": 0.010, "market_growth_actual": 0.008, "plan_tilt": -0.015, "performance": -0.075,
     "seasonality": [1.04, 1.02, 1.00, 0.99, 0.98, 0.96,
                     0.94, 0.92, 1.00, 1.03, 1.05, 1.09]},
    {"id": "home_care", "label": "Home Care", "share": 0.16,
     "list_price": 30.00, "target_gross_margin": 0.400,
     "promo_elasticity": 0.85, "promo_participation": 0.95,
     "market_share": 0.094,
     "market_growth_plan": 0.015, "market_growth_actual": 0.012, "plan_tilt": -0.008, "performance": -0.035,
     "seasonality": [0.98, 1.00, 1.08, 1.12, 1.06, 0.98,
                     0.92, 0.88, 0.98, 1.02, 1.00, 0.98]},
    {"id": "personal_care", "label": "Personal Care", "share": 0.12,
     "list_price": 42.00, "target_gross_margin": 0.520,
     "promo_elasticity": 1.25, "promo_participation": 1.00,
     "market_share": 0.076,
     "market_growth_plan": 0.040, "market_growth_actual": 0.045, "plan_tilt": 0.010, "performance": 0.020,
     "seasonality": [0.92, 0.90, 0.96, 0.98, 1.00, 1.02,
                     1.00, 0.94, 1.00, 1.06, 1.14, 1.28]},
]

# Deviations from a plain channel x category outer product, so the assortment
# is not identical everywhere: the Discount channel barely carries Personal
# Care, wholesalers move a lot of Beverages and almost no Home Care. Unlisted
# pairs default to 1.0 and the grid is renormalised, so these are relative.
CHANNEL_AFFINITY = {
    ("modern_trade", "personal_care"): 1.15,
    ("modern_trade", "home_care"): 1.10,
    ("discount", "personal_care"): 0.70,
    ("discount", "dairy"): 1.15,
    ("discount", "beverages"): 1.05,
    ("wholesale", "beverages"): 1.30,
    ("wholesale", "snacks"): 1.15,
    ("wholesale", "home_care"): 0.70,
    ("wholesale", "personal_care"): 0.60,
}

# Spread of the customer assortment tilt, so two customers on the same
# channel do not look like copies of each other. Drawn once and reused by
# every scenario -- if it were redrawn per scenario, a mix comparison
# between budget and actual would be reading noise.
CUSTOMER_TILT_SPREAD = 0.14

# Reference net realisation, used only to turn a target gross margin into a
# cost per case. Roughly the group average of price index times one minus
# the gross-to-net ratio.
REFERENCE_NET_FACTOR = 0.747

# Split of total COGS across its components. Must sum to 1.
COGS_MIX = {
    "cogs_materials": 0.62,
    "cogs_production": 0.24,
    "cogs_logistics": 0.14,
}

# Brand advertising, as a share of net revenue. Distinct from promotional
# trade spend, which sits above net revenue.
MARKETING_RATIO = 0.085

# Unallocated overhead, as a share of net revenue. Held per category only.
GNA_RATIO = 0.058
RND_RATIO = 0.018

# Depreciation & amortisation, as a share of net revenue, spread evenly with
# a step up once new capacity comes online.
DA_RATIO = 0.036
DA_STEP_MONTH = 7      # month the new assets start depreciating
DA_STEP_UPLIFT = 0.08  # +8% monthly charge from that month on

# List price increase. The plan plays it from March; the actual negotiation
# with the trade pushed it to April, which is exactly the kind of one month
# slip a price/volume/mix bridge is built to expose.
PRICE_INCREASE = 0.045
PRICE_INCREASE_MONTH_BUDGET = 3
PRICE_INCREASE_MONTH_ACTUAL = 4

# How the current year diverges from the plan, on top of the per-channel and
# per-category performance factors above.
PLANNED_COST_INFLATION = 0.030  # input cost inflation the budget assumes
COGS_INFLATION_DRIFT = 0.0028   # actual creep per month on top, compounding
PROMO_DEPTH_UPLIFT = 0.090      # promotions running 9% deeper than agreed
MARKETING_UNDERSPEND = -0.060   # brand A&P held back to fund the trade
GNA_OVERSPEND = 0.045           # overhead running hot

# Share of the year-to-date gap versus budget assumed to persist into the
# remaining months when building the Latest Estimate. 1.0 would mean the run
# rate continues unchanged, 0.0 that the business snaps back to plan.
GAP_PERSISTENCE = 0.72

# Month on month noise, as a standard deviation on a multiplier of 1.0.
NOISE_VOLUME = 0.032
NOISE_COST = 0.011

# Leaf lines: (id, label, group, sign, customer_level).
# sign 0 marks a statistical line that is not part of the P&L ladder.
LEAF_LINES = [
    ("gross_sales", "Gross Sales", "gross_sales", 1, True),
    ("discount_on_invoice", "On-Invoice Discounts", "discounts", -1, True),
    ("trade_spend_promo", "Promotional Trade Spend", "discounts", -1, True),
    ("trade_spend_other", "Other Trade Spend", "discounts", -1, True),
    ("returns", "Returns & Credit Notes", "discounts", -1, True),
    ("cogs_materials", "COGS - Raw & Packaging", "cogs", -1, True),
    ("cogs_production", "COGS - Production", "cogs", -1, True),
    ("cogs_logistics", "COGS - Logistics", "cogs", -1, True),
    ("opex_marketing", "Brand Marketing", "opex_direct", -1, True),
    ("opex_sales", "Sales & Distribution", "opex_direct", -1, True),
    ("opex_gna", "General & Administrative", "opex_indirect", -1, False),
    ("opex_rnd", "Research & Development", "opex_indirect", -1, False),
    ("d_and_a", "Depreciation & Amortisation", "d_and_a", -1, False),
    ("volume_baseline", "Baseline Volume", "volume", 0, True),
    ("volume_incremental", "Incremental Volume", "volume", 0, True),
    ("volume_on_promo", "Volume Sold on Promotion", "volume", 0, True),
    ("market_value", "Category Market Size", "market", 0, False),
    ("market_volume", "Category Market Volume", "market", 0, False),
]

# The P&L ladder the dashboard renders. `group` rows total their leaf lines,
# `subtotal` rows combine rows defined earlier in this list. `customer_level`
# says whether the row exists when the view is filtered to a customer: the
# customer P&L stops at contribution margin.
PNL_STRUCTURE = [
    {"id": "gross_sales", "label": "Gross Sales", "type": "group",
     "components": ["gross_sales"], "emphasis": "strong",
     "customer_level": True},
    {"id": "discounts", "label": "Discounts & Trade Spend", "type": "group",
     "components": ["discount_on_invoice", "trade_spend_promo",
                    "trade_spend_other", "returns"],
     "emphasis": "normal", "customer_level": True},
    {"id": "net_revenue", "label": "Net Revenue", "type": "subtotal",
     "formula": [["+", "gross_sales"], ["-", "discounts"]],
     "emphasis": "strong", "customer_level": True},
    {"id": "cogs", "label": "Cost of Goods Sold", "type": "group",
     "components": ["cogs_materials", "cogs_production", "cogs_logistics"],
     "emphasis": "normal", "customer_level": True},
    {"id": "gross_profit", "label": "Gross Profit", "type": "subtotal",
     "formula": [["+", "net_revenue"], ["-", "cogs"]],
     "emphasis": "strong", "customer_level": True},
    {"id": "opex_direct", "label": "Direct Commercial Costs",
     "type": "group", "components": ["opex_marketing", "opex_sales"],
     "emphasis": "normal", "customer_level": True},
    {"id": "contribution_margin", "label": "Contribution Margin",
     "type": "subtotal",
     "formula": [["+", "gross_profit"], ["-", "opex_direct"]],
     "emphasis": "strong", "customer_level": True},
    {"id": "opex_indirect", "label": "Unallocated Overhead", "type": "group",
     "components": ["opex_gna", "opex_rnd"], "emphasis": "normal",
     "customer_level": False},
    {"id": "ebitda", "label": "EBITDA", "type": "subtotal",
     "formula": [["+", "contribution_margin"], ["-", "opex_indirect"]],
     "emphasis": "strong", "customer_level": False},
    {"id": "d_and_a", "label": "Depreciation & Amortisation",
     "type": "group", "components": ["d_and_a"], "emphasis": "normal",
     "customer_level": False},
    {"id": "ebit", "label": "EBIT", "type": "subtotal",
     "formula": [["+", "ebitda"], ["-", "d_and_a"]], "emphasis": "strong",
     "customer_level": False},
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

CHANNEL_BY_ID = {c["id"]: c for c in CHANNELS}
CATEGORY_BY_ID = {c["id"]: c for c in CATEGORIES}
CUSTOMER_BY_ID = {c["id"]: c for c in CUSTOMERS}


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def normalise(values):
    """Rescale a list so that its mean is exactly 1.0."""
    mean = sum(values) / len(values)
    return [v / mean for v in values]


def campaign_curve(seasonality):
    """Brand marketing phasing: spend leads the sales peak by about a month.

    Blended with a flat baseline because part of the media plan is always-on
    rather than campaign driven.
    """
    led = [seasonality[(i + 1) % 12] for i in range(12)]
    return normalise([0.40 + 0.60 * v for v in led])


def da_curve():
    """Monthly D&A weights: flat, with a step up once new assets go live."""
    raw = [1.0 if m < DA_STEP_MONTH else 1.0 + DA_STEP_UPLIFT for m in MONTHS]
    return normalise(raw)


def cost_per_case(cat):
    """Cost per case implied by the category target gross margin.

    Derived rather than hardcoded so that changing a list price or a margin
    target keeps the two consistent.
    """
    reference_net_price = cat["list_price"] * REFERENCE_NET_FACTOR
    return reference_net_price * (1.0 - cat["target_gross_margin"])


def unit_cost_factor(scenario_id, month):
    """Input cost inflation applied to the cost per case.

    The plan carries a flat assumption agreed at budget time; the actual
    starts from that same assumption and then drifts above it month after
    month. Without the planned leg the budget would quietly assume a price
    increase against flat costs, and the whole margin variance would be an
    artefact of an unrealistic plan rather than a real trading story.
    """
    if scenario_id == "ly_actual":
        return 1.0
    planned = 1.0 + PLANNED_COST_INFLATION
    if scenario_id == "budget":
        return planned
    return planned * (1.0 + COGS_INFLATION_DRIFT) ** (month - 1)


def list_price(cat, scenario_id, month):
    """List price per case, including the current year price increase."""
    if scenario_id == "ly_actual":
        return cat["list_price"]
    if scenario_id == "budget":
        step = PRICE_INCREASE_MONTH_BUDGET
    else:
        step = PRICE_INCREASE_MONTH_ACTUAL
    uplift = PRICE_INCREASE if month >= step else 0.0
    return cat["list_price"] * (1.0 + uplift)


def build_mix(rng):
    """Volume weight per (customer, category), summing to 1.0."""
    grid = {}
    for cust in CUSTOMERS:
        for cat in CATEGORIES:
            weight = cust["share"] * cat["share"]
            weight *= CHANNEL_AFFINITY.get((cust["channel"], cat["id"]), 1.0)
            weight *= 1.0 + rng.uniform(-CUSTOMER_TILT_SPREAD,
                                        CUSTOMER_TILT_SPREAD)
            grid[(cust["id"], cat["id"])] = weight
    total = sum(grid.values())
    return {k: v / total for k, v in grid.items()}


# --------------------------------------------------------------------------
# Volume generation
# --------------------------------------------------------------------------

def volume_ly(rng, mix, seasonality):
    """Prior year monthly volume per customer and category, in cases."""
    out = {}
    for cust in CUSTOMERS:
        for cat in CATEGORIES:
            annual = TOTAL_VOLUME_LY * mix[(cust["id"], cat["id"])]
            curve = seasonality[cat["id"]]
            for m in MONTHS:
                noise = rng.gauss(1.0, NOISE_VOLUME)
                out[(cust["id"], cat["id"], m)] = max(
                    annual / 12.0 * curve[m - 1] * noise, 0.0)
    return out


def volume_budget(ly, seasonality):
    """Budget volume: LY grown by the plan, rephased, no noise.

    The plan is built on the full year LY total and then phased on the clean
    seasonality curve, which is why it comes out smooth: planners phase a
    target, they do not replay last year monthly wobble.
    """
    out = {}
    for cust in CUSTOMERS:
        channel = CHANNEL_BY_ID[cust["channel"]]
        for cat in CATEGORIES:
            ly_annual = sum(ly[(cust["id"], cat["id"], m)] for m in MONTHS)
            annual = (ly_annual * (1.0 + channel["plan_growth"])
                      * (1.0 + cat["plan_tilt"]))
            curve = seasonality[cat["id"]]
            for m in MONTHS:
                out[(cust["id"], cat["id"], m)] = annual / 12.0 * curve[m - 1]
    return out


def volume_actual(rng, budget):
    """Current year actual volume: budget distorted by performance.

    The gap widens through the year rather than appearing in full in
    January, which is how a trading gap normally builds.
    """
    out = {}
    for cust in CUSTOMERS:
        channel = CHANNEL_BY_ID[cust["channel"]]
        for cat in CATEGORIES:
            gap = channel["performance"] + cat["performance"]
            for m in MONTHS:
                ramp = 0.60 + 0.40 * (m / 12.0)
                noise = rng.gauss(1.0, NOISE_VOLUME)
                out[(cust["id"], cat["id"], m)] = max(
                    budget[(cust["id"], cat["id"], m)]
                    * (1.0 + gap * ramp) * noise, 0.0)
    return out


def volume_forecast(budget, actual):
    """Latest Estimate volume: actuals to date, re-forecast beyond.

    Open months are the budget adjusted by the year-to-date performance
    ratio, damped by GAP_PERSISTENCE so the forecast neither assumes the run
    rate holds perfectly nor that the business returns straight to plan.
    """
    out = {}
    for cust in CUSTOMERS:
        for cat in CATEGORIES:
            closed = [m for m in MONTHS if m <= LAST_CLOSED_MONTH]
            ytd_actual = sum(actual[(cust["id"], cat["id"], m)]
                             for m in closed)
            ytd_budget = sum(budget[(cust["id"], cat["id"], m)]
                             for m in closed)
            ratio = ytd_actual / ytd_budget if ytd_budget else 1.0
            carried = 1.0 + (ratio - 1.0) * GAP_PERSISTENCE
            for m in MONTHS:
                cell = (cust["id"], cat["id"], m)
                out[cell] = (actual[cell] if m <= LAST_CLOSED_MONTH
                             else budget[cell] * carried)
    return out


# --------------------------------------------------------------------------
# Commercial and cost derivation
# --------------------------------------------------------------------------

def customer_facts(rng, scenario_id, volume):
    """Everything held per customer and category, derived from volume.

    Returns a list of (line_id, month, customer_id, category_id, value).
    Brand marketing is not built here: it depends on category net revenue,
    which is only known once every customer has been priced.
    """
    inflated = scenario_id in ("cy_actual", "forecast")
    rows = []

    for cust in CUSTOMERS:
        channel = CHANNEL_BY_ID[cust["channel"]]
        for cat in CATEGORIES:
            unit_cost = cost_per_case(cat)
            promo_share = min(
                channel["promo_volume_share"] * cat["promo_participation"],
                0.60)
            incremental_share = (channel["incremental_base"]
                                 * cat["promo_elasticity"])
            promo_depth = channel["promo_depth"]
            if inflated:
                promo_depth *= 1.0 + PROMO_DEPTH_UPLIFT

            for m in MONTHS:
                cases = volume[(cust["id"], cat["id"], m)]
                price = list_price(cat, scenario_id, m) * channel["price_index"]
                gross = cases * price

                # --- volume split ----------------------------------------
                incremental = cases * incremental_share
                rows.append(("volume_baseline", m, cust["id"], cat["id"],
                             cases - incremental))
                rows.append(("volume_incremental", m, cust["id"], cat["id"],
                             incremental))
                rows.append(("volume_on_promo", m, cust["id"], cat["id"],
                             cases * promo_share))

                # --- gross to net ----------------------------------------
                rows.append(("gross_sales", m, cust["id"], cat["id"], gross))
                rows.append(("discount_on_invoice", m, cust["id"], cat["id"],
                             gross * channel["discount_on_invoice"]))
                # Promotional spend is priced off the cases actually promoted
                # and the depth granted on them, not taken as a flat share of
                # gross sales -- that link is what makes promo ROI real.
                rows.append(("trade_spend_promo", m, cust["id"], cat["id"],
                             cases * promo_share * price * promo_depth))
                rows.append(("trade_spend_other", m, cust["id"], cat["id"],
                             gross * channel["trade_other"]))
                rows.append(("returns", m, cust["id"], cat["id"],
                             gross * channel["returns"]))

                # --- COGS, driven by cases and not by revenue ------------
                unit = unit_cost * unit_cost_factor(scenario_id, m)
                if inflated:
                    unit *= rng.gauss(1.0, NOISE_COST)
                total_cogs = cases * unit
                for line_id, weight in COGS_MIX.items():
                    rows.append((line_id, m, cust["id"], cat["id"],
                                 total_cogs * weight))

                # --- cost to serve ---------------------------------------
                serve = cases * channel["cost_to_serve"]
                if inflated:
                    serve *= rng.gauss(1.0, NOISE_COST)
                rows.append(("opex_sales", m, cust["id"], cat["id"], serve))

    return rows


def net_revenue_by_category(rows):
    """Category net revenue per month, needed to size the overhead lines."""
    sign = {i: s for i, _, _, s, _ in LEAF_LINES}
    group = {i: g for i, _, g, _, _ in LEAF_LINES}
    out = {}
    for line_id, m, _cust, cat_id, value in rows:
        if group[line_id] not in ("gross_sales", "discounts"):
            continue
        out[(cat_id, m)] = out.get((cat_id, m), 0.0) + sign[line_id] * value
    return out


def marketing_facts(rng, scenario_id, rows, net_revenue, campaigns):
    """Brand marketing, phased on the campaign calendar.

    The category media budget is a share of category net revenue and is
    phased on its own calendar, then split across customers on their volume
    share. It deliberately does not follow monthly sales: fixed spend landing
    on a seasonal revenue base is one of the reasons monthly margin moves.
    """
    inflated = scenario_id in ("cy_actual", "forecast")
    ratio = MARKETING_RATIO * (1.0 + MARKETING_UNDERSPEND if inflated else 1.0)

    volume_by_cat = {}
    volume_by_cell = {}
    for line_id, m, cust_id, cat_id, value in rows:
        if line_id not in ("volume_baseline", "volume_incremental"):
            continue
        volume_by_cat[cat_id] = volume_by_cat.get(cat_id, 0.0) + value
        key = (cust_id, cat_id)
        volume_by_cell[key] = volume_by_cell.get(key, 0.0) + value

    out = []
    for cat in CATEGORIES:
        annual_net = sum(net_revenue.get((cat["id"], m), 0.0) for m in MONTHS)
        budget_total = annual_net * ratio
        curve = campaigns[cat["id"]]
        for cust in CUSTOMERS:
            key = (cust["id"], cat["id"])
            weight = volume_by_cell.get(key, 0.0) / volume_by_cat[cat["id"]]
            for m in MONTHS:
                value = budget_total * curve[m - 1] / 12.0 * weight
                if inflated:
                    value *= rng.gauss(1.0, NOISE_COST)
                out.append(("opex_marketing", m, cust["id"], cat["id"], value))
    return out


def category_facts(rng, scenario_id, rows, net_revenue, da_weights,
                   market_base, seasonality):
    """Unallocated overhead, D&A and market size: category grain, no customer.

    Returns (line_id, month, None, category_id, value).
    """
    inflated = scenario_id in ("cy_actual", "forecast")

    out = []
    for cat in CATEGORIES:
        annual_net = sum(net_revenue.get((cat["id"], m), 0.0) for m in MONTHS)
        if scenario_id == "ly_actual":
            market_growth = 0.0
        elif scenario_id == "budget":
            market_growth = cat["market_growth_plan"]
        else:
            market_growth = cat["market_growth_actual"]
        for m in MONTHS:
            gna = annual_net * GNA_RATIO / 12.0
            if inflated:
                gna *= (1.0 + GNA_OVERSPEND) * rng.gauss(1.0, NOISE_COST)
            out.append(("opex_gna", m, None, cat["id"], gna))

            rnd = annual_net * RND_RATIO / 12.0
            if inflated:
                rnd *= rng.gauss(1.0, NOISE_COST)
            out.append(("opex_rnd", m, None, cat["id"], rnd))

            out.append(("d_and_a", m, None, cat["id"],
                        annual_net * DA_RATIO * da_weights[m - 1] / 12.0))

            # The market is an independent series: it is sized once off the
            # prior year and then grows at its own rate. Deriving it from our
            # own volume instead would pin our share to a constant and make
            # every share chart a tautology -- losing a category would shrink
            # the market with us rather than showing up as share loss.
            annual_market = market_base[cat["id"]] * (1.0 + market_growth)
            cases = annual_market / 12.0 * seasonality[cat["id"]][m - 1]
            out.append(("market_volume", m, None, cat["id"], cases))
            # Measured at manufacturer selling price, so that value share is
            # comparable with our own net revenue.
            out.append(("market_value", m, None, cat["id"],
                        cases * list_price(cat, scenario_id, m)
                        * REFERENCE_NET_FACTOR))
    return out


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------

def build_facts(rng):
    seasonality = {c["id"]: normalise(c["seasonality"]) for c in CATEGORIES}
    campaigns = {c["id"]: campaign_curve(seasonality[c["id"]])
                 for c in CATEGORIES}
    da_weights = da_curve()
    mix = build_mix(rng)

    ly = volume_ly(rng, mix, seasonality)
    budget = volume_budget(ly, seasonality)
    actual = volume_actual(rng, budget)
    forecast = volume_forecast(budget, actual)

    volumes = {"ly_actual": ly, "budget": budget,
               "cy_actual": actual, "forecast": forecast}

    # Prior year market size per category, fixed once so that every later
    # scenario measures share against the same independent baseline.
    market_base = {}
    for cat in CATEGORIES:
        our_volume = sum(ly[(cust["id"], cat["id"], m)]
                         for cust in CUSTOMERS for m in MONTHS)
        market_base[cat["id"]] = our_volume / cat["market_share"]

    per_scenario = {}
    for scenario_id, volume in volumes.items():
        rows = customer_facts(rng, scenario_id, volume)
        net_revenue = net_revenue_by_category(rows)
        rows += marketing_facts(rng, scenario_id, rows, net_revenue, campaigns)
        rows += category_facts(rng, scenario_id, rows, net_revenue,
                               da_weights, market_base, seasonality)
        per_scenario[scenario_id] = rows

    # Closed months of the Latest Estimate are the actuals, every line
    # included -- a forecast never restates a month that is already booked.
    booked = {(line_id, m, cust_id, cat_id): value
              for line_id, m, cust_id, cat_id, value
              in per_scenario["cy_actual"] if m <= LAST_CLOSED_MONTH}
    per_scenario["forecast"] = [
        (line_id, m, cust_id, cat_id,
         booked.get((line_id, m, cust_id, cat_id), value)
         if m <= LAST_CLOSED_MONTH else value)
        for line_id, m, cust_id, cat_id, value in per_scenario["forecast"]
    ]

    facts = []
    for scenario_id, rows in per_scenario.items():
        for line_id, m, cust_id, cat_id, value in rows:
            facts.append({
                "scenario": scenario_id, "month": m, "customer": cust_id,
                "category": cat_id, "line": line_id, "value": round(value, 2),
            })

    line_order = {line[0]: i for i, line in enumerate(LEAF_LINES)}
    scenario_order = {s["id"]: i for i, s in enumerate(SCENARIOS)}
    cust_order = {c["id"]: i for i, c in enumerate(CUSTOMERS)}
    cat_order = {c["id"]: i for i, c in enumerate(CATEGORIES)}
    facts.sort(key=lambda r: (
        scenario_order[r["scenario"]], r["month"],
        cust_order.get(r["customer"], len(CUSTOMERS)),
        cat_order[r["category"]], line_order[r["line"]],
    ))
    return facts


def build_price_list():
    """List price per case by category, month and scenario.

    Kept out of the fact table because a price is not additive: summing it
    across months or categories is meaningless, and a chart that did so
    would be silently wrong.
    """
    out = []
    for scenario in SCENARIOS:
        for cat in CATEGORIES:
            for m in MONTHS:
                out.append({
                    "scenario": scenario["id"], "month": m,
                    "category": cat["id"],
                    "list_price": round(list_price(cat, scenario["id"], m), 4),
                })
    return out


def build_meta():
    return {
        "description": (
            "Synthetic FMCG P&L dataset for a fictional Italian group. No "
            "real or sensitive data: figures are generated from industry "
            "benchmark ratios."
        ),
        "country": COUNTRY,
        "currency": CURRENCY,
        "unit": "full currency units",
        "volume_unit": VOLUME_UNIT,
        "current_year": CURRENT_YEAR,
        "prior_year": PRIOR_YEAR,
        "last_closed_month": LAST_CLOSED_MONTH,
        "value_convention": (
            "All values are positive magnitudes; use pnl_lines[].sign to know "
            "whether a line adds to or subtracts from the result. Sign 0 "
            "marks statistical lines (volume, market) that sit outside the "
            "P&L ladder."
        ),
        "grain": (
            "One fact per scenario, month, customer, category and line. "
            "Lines with customer_level false are held per category only and "
            "carry a null customer: the customer P&L stops at contribution "
            "margin."
        ),
        "derived_metrics_note": (
            "No KPI is precomputed. Promotional pressure, gross-to-net "
            "ratio, trade spend efficiency, promo ROI, market share and the "
            "price/volume/mix bridge are all derivable from these measures "
            "in /js/logic."
        ),
        "scenarios": SCENARIOS,
        "months": [{"n": m, "short": MONTH_NAMES[m - 1][0],
                    "label": MONTH_NAMES[m - 1][1]} for m in MONTHS],
        "channels": [{"id": c["id"], "label": c["label"]} for c in CHANNELS],
        "customers": [{"id": c["id"], "label": c["label"],
                       "channel": c["channel"], "area": c["area"]}
                      for c in CUSTOMERS],
        "areas": sorted({c["area"] for c in CUSTOMERS}),
        "categories": [{"id": c["id"], "label": c["label"]}
                       for c in CATEGORIES],
        "pnl_lines": [{"id": i, "label": l, "group": g, "sign": s,
                       "customer_level": cl}
                      for i, l, g, s, cl in LEAF_LINES],
        "pnl_structure": PNL_STRUCTURE,
    }


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------

def write_json(path, meta, facts, price_list):
    """Pretty metadata, one compact fact per line: small file, readable diff."""
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write("{\n")
        f.write('"meta": ')
        f.write(json.dumps(meta, ensure_ascii=False, indent=2))
        f.write(",\n")
        f.write('"price_list": [\n')
        for i, row in enumerate(price_list):
            f.write(json.dumps(row, ensure_ascii=False,
                               separators=(",", ":")))
            f.write(",\n" if i < len(price_list) - 1 else "\n")
        f.write("],\n")
        f.write('"facts": [\n')
        for i, fact in enumerate(facts):
            f.write(json.dumps(fact, ensure_ascii=False,
                               separators=(",", ":")))
            f.write(",\n" if i < len(facts) - 1 else "\n")
        f.write("]\n}\n")


def write_csv(path, facts):
    fields = ["scenario", "month", "customer", "category", "line", "value"]
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(facts)


# --------------------------------------------------------------------------
# Validation and reporting
# --------------------------------------------------------------------------

def ladder(facts, scenario_id, through_month=12, customer=None, channel=None):
    """Compute the P&L ladder for one scenario and optional filter."""
    totals = {}
    for f in facts:
        if f["scenario"] != scenario_id or f["month"] > through_month:
            continue
        if customer and f["customer"] != customer:
            continue
        if channel:
            cust = CUSTOMER_BY_ID.get(f["customer"])
            if not cust or cust["channel"] != channel:
                continue
        totals[f["line"]] = totals.get(f["line"], 0.0) + f["value"]

    # Groups and subtotals are derived from the published structure, exactly
    # the way /js/logic will have to do it. Accumulating a group alongside
    # its leaf lines would double count any group that shares an id with its
    # only component.
    for row in PNL_STRUCTURE:
        if row["type"] == "group":
            totals[row["id"]] = sum(totals.get(c, 0.0)
                                    for c in row["components"])
        else:
            totals[row["id"]] = sum(
                totals.get(ref, 0.0) * (1 if op == "+" else -1)
                for op, ref in row["formula"])
    totals["volume_total"] = (totals.get("volume_baseline", 0.0)
                              + totals.get("volume_incremental", 0.0))
    return totals


def validate(facts):
    """Fail loudly if the generated numbers leave FMCG plausibility."""
    for f in facts:
        if f["value"] < 0:
            raise ValueError("negative value generated: " + repr(f))

    allowed_null = {i for i, _, _, _, cl in LEAF_LINES if not cl}
    for f in facts:
        if (f["customer"] is None) != (f["line"] in allowed_null):
            raise ValueError("grain mismatch on line: " + repr(f))

    # Incremental volume can never exceed the volume actually promoted.
    promo = {}
    incr = {}
    for f in facts:
        key = (f["scenario"], f["month"], f["customer"], f["category"])
        if f["line"] == "volume_on_promo":
            promo[key] = f["value"]
        elif f["line"] == "volume_incremental":
            incr[key] = f["value"]
    for key, value in incr.items():
        if value > promo[key] + 0.01:
            raise ValueError("incremental volume exceeds promoted volume at "
                             + repr(key))

    for scenario in SCENARIOS:
        t = ladder(facts, scenario["id"])
        gm = t["gross_profit"] / t["net_revenue"]
        ebitda = t["ebitda"] / t["net_revenue"]
        g2n = 1.0 - t["net_revenue"] / t["gross_sales"]
        if not 0.32 <= gm <= 0.50:
            raise ValueError("{}: gross margin {:.1%} outside 32-50%".format(
                scenario["id"], gm))
        if not 0.08 <= ebitda <= 0.25:
            raise ValueError("{}: EBITDA margin {:.1%} outside 8-25%".format(
                scenario["id"], ebitda))
        if not 0.12 <= g2n <= 0.30:
            raise ValueError("{}: gross-to-net {:.1%} outside 12-30%".format(
                scenario["id"], g2n))

    # The Latest Estimate must not restate a closed month.
    booked = {(f["month"], f["customer"], f["category"], f["line"]): f["value"]
              for f in facts if f["scenario"] == "cy_actual"}
    for f in facts:
        if f["scenario"] != "forecast" or f["month"] > LAST_CLOSED_MONTH:
            continue
        key = (f["month"], f["customer"], f["category"], f["line"])
        if abs(booked[key] - f["value"]) > 0.01:
            raise ValueError("forecast restates closed month: " + repr(key))


def report(facts):
    totals = {s["id"]: ladder(facts, s["id"]) for s in SCENARIOS}

    print("\nFull year P&L by scenario (" + CURRENCY
          + " m, % of net revenue)\n")
    header = "{:<30}".format("") + "".join(
        "{:>19}".format(s["label"]) for s in SCENARIOS)
    print(header)
    print("-" * len(header))
    for row in PNL_STRUCTURE:
        line = "{:<30}".format(
            ("  " if row["emphasis"] == "normal" else "") + row["label"])
        for s in SCENARIOS:
            t = totals[s["id"]]
            line += "{:>12,.1f}{:>7.1%}".format(
                t[row["id"]] / 1e6, t[row["id"]] / t["net_revenue"])
        print(line)

    print("\nChannel view, full year actual\n")
    print("{:<15}{:>11}{:>10}{:>9}{:>9}{:>9}{:>9}".format(
        "", "Volume m", "Net rev", "G2N", "GM", "CM", "vs Bud"))
    for ch in CHANNELS:
        a = ladder(facts, "cy_actual", channel=ch["id"])
        b = ladder(facts, "budget", channel=ch["id"])
        print("{:<15}{:>11,.2f}{:>10,.1f}{:>9.1%}{:>9.1%}{:>9.1%}{:>+9.1%}".
              format(ch["label"], a["volume_total"] / 1e6,
                     a["net_revenue"] / 1e6,
                     1 - a["net_revenue"] / a["gross_sales"],
                     a["gross_profit"] / a["net_revenue"],
                     a["contribution_margin"] / a["net_revenue"],
                     a["net_revenue"] / b["net_revenue"] - 1))

    print("\nPromotional read, full year actual\n")
    print("{:<15}{:>12}{:>13}{:>12}{:>10}".format(
        "", "% on promo", "% increment.", "Promo spend", "ROI"))
    for ch in CHANNELS:
        t = ladder(facts, "cy_actual", channel=ch["id"])
        contribution_per_case = ((t["net_revenue"] - t["cogs"])
                                 / t["volume_total"])
        roi = (t["volume_incremental"] * contribution_per_case
               / t["trade_spend_promo"])
        print("{:<15}{:>12.1%}{:>13.1%}{:>12,.1f}{:>10.2f}".format(
            ch["label"], t["volume_on_promo"] / t["volume_total"],
            t["volume_incremental"] / t["volume_total"],
            t["trade_spend_promo"] / 1e6, roi))

    ytd = {s["id"]: ladder(facts, s["id"], LAST_CLOSED_MONTH)
           for s in SCENARIOS}
    print("\nYTD (Jan-{}) net revenue vs budget: {:+.1%}".format(
        MONTH_NAMES[LAST_CLOSED_MONTH - 1][0],
        ytd["cy_actual"]["net_revenue"] / ytd["budget"]["net_revenue"] - 1))
    print("Full year forecast vs budget:      {:+.1%}".format(
        totals["forecast"]["net_revenue"] / totals["budget"]["net_revenue"] - 1))


def main():
    rng = random.Random(SEED)
    facts = build_facts(rng)
    meta = build_meta()
    price_list = build_price_list()

    validate(facts)
    write_json(JSON_PATH, meta, facts, price_list)
    write_csv(CSV_PATH, facts)

    print("Generated {:,} facts".format(len(facts)))
    print("  {}  {:,.0f} KB".format(
        JSON_PATH.name, JSON_PATH.stat().st_size / 1024))
    print("  {}  {:,.0f} KB".format(
        CSV_PATH.name, CSV_PATH.stat().st_size / 1024))
    report(facts)


if __name__ == "__main__":
    main()
