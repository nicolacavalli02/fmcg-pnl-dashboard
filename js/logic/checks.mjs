/**
 * Self-checks for the logic layer.
 *
 *   node js/logic/checks.mjs
 *
 * Two kinds of assertion live here. The first kind checks the arithmetic
 * against itself: subtotals reconcile, breakdowns add back to the total,
 * bridges tie to zero. The second kind checks the JavaScript against the
 * Python that produced the data -- the expected figures below were printed
 * by data/generate_data.py, so if the two implementations ever disagree
 * about what gross profit means, this fails rather than shipping two
 * different answers to the same question.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createDataset,
  ladder,
  ladderBy,
  metrics,
  metricsFrom,
  monthlySeries,
  compareLadders,
  varianceBy,
  pnlBridge,
  priceVolumeMixBridge,
  contributionBridge,
  averageListPrice,
  closedMonths,
} from "./index.js";

const dataPath = fileURLToPath(
  new URL("../../data/pnl_dataset.json", import.meta.url)
);
const dataset = createDataset(JSON.parse(readFileSync(dataPath, "utf8")));

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

function near(name, actual, expected, tolerance) {
  const ok = actual !== null && Math.abs(actual - expected) <= tolerance;
  check(
    name,
    ok,
    ok ? "" : `expected ${expected}, got ${actual === null ? "null" : actual.toFixed(4)}`
  );
}

const M = 1e6;
const FY = (scenario) => ({ scenario });
const YTD = (scenario) => ({ scenario, months: closedMonths(dataset) });

// ---------------------------------------------------------------------------
// 1. The ladder reproduces the figures the generator reported
// ---------------------------------------------------------------------------

const expected = {
  ly_actual: { net_revenue: 336.4, gross_profit: 141.4, ebitda: 57.0, ebit: 44.9 },
  budget: { net_revenue: 359.2, gross_profit: 152.7, ebitda: 63.8, ebit: 50.8 },
  cy_actual: { net_revenue: 349.3, gross_profit: 142.8, ebitda: 56.9, ebit: 44.3 },
  forecast: { net_revenue: 349.9, gross_profit: 143.0, ebitda: 56.9, ebit: 44.3 },
};

for (const [scenario, rows] of Object.entries(expected)) {
  const pnl = ladder(dataset, FY(scenario));
  for (const [rowId, value] of Object.entries(rows)) {
    near(`${scenario}.${rowId} matches the generator`, pnl.value(rowId) / M, value, 0.06);
  }
}

// ---------------------------------------------------------------------------
// 2. The ladder is internally consistent
// ---------------------------------------------------------------------------

const fy = ladder(dataset, FY("cy_actual"));
near(
  "net revenue = gross sales - discounts",
  fy.value("net_revenue"),
  fy.value("gross_sales") - fy.value("discounts"),
  0.01
);
near(
  "EBIT = EBITDA - D&A",
  fy.value("ebit"),
  fy.value("ebitda") - fy.value("d_and_a"),
  0.01
);
near(
  "COGS group = its three components",
  fy.value("cogs"),
  fy.value("cogs_materials") + fy.value("cogs_production") + fy.value("cogs_logistics"),
  0.01
);
check(
  "gross sales row carries a positive sign",
  dataset.signOf("gross_sales") === 1
);
check("COGS group carries a cost sign", dataset.signOf("cogs") === -1);
check("subtotals are treated as income", dataset.signOf("ebitda") === 1);

// ---------------------------------------------------------------------------
// 3. Breakdowns add back to the total
// ---------------------------------------------------------------------------

for (const dimension of ["category", "customer", "channel", "area", "month"]) {
  const parts = ladderBy(dataset, FY("cy_actual"), dimension);
  const total = parts.reduce((sum, part) => sum + part.ladder.value("net_revenue"), 0);
  near(`net revenue by ${dimension} adds back to the total`, total, fy.value("net_revenue"), 1);
}

const byCustomer = ladderBy(dataset, FY("cy_actual"), "customer", {
  sortBy: "net_revenue",
});
check("twelve customers are returned", byCustomer.length === 12);
check(
  "customers come back ranked",
  byCustomer[0].label === "IperVia" && byCustomer[0].ladder.value("net_revenue") >
    byCustomer[11].ladder.value("net_revenue")
);

// Overhead is held per category, so a category split still reaches EBITDA
// while a customer split must not.
check(
  "a category split still reports EBITDA",
  ladderBy(dataset, FY("cy_actual"), "category")[0].ladder.value("ebitda") !== null
);
check(
  "a customer split reports contribution margin",
  byCustomer[0].ladder.value("contribution_margin") !== null
);
check(
  "a customer split refuses to report EBITDA",
  byCustomer[0].ladder.value("ebitda") === null
);

// ---------------------------------------------------------------------------
// 4. Customer scoping propagates through the ladder
// ---------------------------------------------------------------------------

const scoped = ladder(dataset, { scenario: "cy_actual", customers: ["ipervia"] });
check("scoped view keeps net revenue", scoped.value("net_revenue") > 0);
check("scoped view keeps contribution margin", scoped.value("contribution_margin") !== null);
check("scoped view drops unallocated overhead", scoped.value("opex_indirect") === null);
check("scoped view drops EBITDA", scoped.value("ebitda") === null);
check("scoped view drops EBIT, which depends on EBITDA", scoped.value("ebit") === null);
check(
  "an unavailable row reports no share of net revenue",
  scoped.get("ebitda").shareOfNetRevenue === null
);
check(
  "EBITDA is not silently equal to contribution margin when scoped",
  scoped.get("ebitda").value === null &&
    scoped.get("contribution_margin").value !== null
);

const channelScoped = ladder(dataset, { scenario: "cy_actual", channels: ["discount"] });
check("a channel filter is customer scoping too", channelScoped.value("ebitda") === null);
const categoryScoped = ladder(dataset, { scenario: "cy_actual", categories: ["dairy"] });
check("a category filter is not customer scoping", categoryScoped.value("ebitda") !== null);

// ---------------------------------------------------------------------------
// 5. Metrics reproduce the generator's channel and promotional read
// ---------------------------------------------------------------------------

const channelExpected = {
  modern_trade: { net: 191.1, g2n: 0.238, gm: 0.431, roi: 0.56, pressure: 0.390 },
  discount: { net: 105.3, g2n: 0.162, gm: 0.374, roi: 0.52, pressure: 0.124 },
  wholesale: { net: 53.0, g2n: 0.207, gm: 0.398, roi: 0.67, pressure: 0.188 },
};

for (const [channel, want] of Object.entries(channelExpected)) {
  const kpi = metrics(dataset, { scenario: "cy_actual", channels: [channel] });
  near(`${channel} net revenue`, kpi.netRevenue / M, want.net, 0.06);
  near(`${channel} gross-to-net`, kpi.grossToNetPct, want.g2n, 0.001);
  near(`${channel} gross margin`, kpi.grossMarginPct, want.gm, 0.001);
  near(`${channel} promo ROI`, kpi.promoROI, want.roi, 0.005);
  near(`${channel} promotional pressure`, kpi.promoPressurePct, want.pressure, 0.001);
  check(`${channel} cannot report EBITDA margin`, kpi.ebitdaMarginPct === null);
  check(`${channel} cannot report market share`, kpi.marketShareVolumePct === null);
}

const dairy = metrics(dataset, { scenario: "cy_actual", categories: ["dairy"] });
near("dairy promo ROI is the worst in the portfolio", dairy.promoROI, 0.27, 0.01);
near("dairy volume market share", dairy.marketShareVolumePct, 0.1556, 0.001);
const personalCare = metrics(dataset, {
  scenario: "cy_actual",
  categories: ["personal_care"],
});
near("personal care promo ROI is the best", personalCare.promoROI, 0.82, 0.01);
check(
  "promo ROI actually separates the portfolio",
  personalCare.promoROI - dairy.promoROI > 0.4
);

const group = metrics(dataset, FY("cy_actual"));
near("group gross margin", group.grossMarginPct, 0.409, 0.002);
near("group EBITDA margin", group.ebitdaMarginPct, 0.163, 0.002);
near("group gross-to-net", group.grossToNetPct, 0.212, 0.002);
check(
  "volume splits into baseline and incremental",
  Math.abs(group.volumeBaseline + group.volumeIncremental - group.volumeTotal) < 0.01
);
check(
  "promoted volume exceeds the volume the promotion created",
  group.volumeOnPromo > group.volumeIncremental
);
check(
  "net price per case sits below gross price per case",
  group.netPricePerCase < group.grossPricePerCase
);

// The list price rise was planned for March and landed in April.
near(
  "beverages list price before the increase",
  dataset.listPrice("cy_actual", "beverages", 3),
  24.0,
  0.001
);
near(
  "beverages list price after the increase",
  dataset.listPrice("cy_actual", "beverages", 4),
  25.08,
  0.001
);
check(
  "the plan raised the price a month earlier than the actual did",
  dataset.listPrice("budget", "beverages", 3) >
    dataset.listPrice("cy_actual", "beverages", 3)
);
const listPrice = averageListPrice(dataset, FY("cy_actual"));
check(
  "average list price sits above the realised gross price",
  listPrice > group.grossPricePerCase
);

// ---------------------------------------------------------------------------
// 6. Variance knows which direction is good news
// ---------------------------------------------------------------------------

const comparison = compareLadders(dataset, YTD("cy_actual"), { against: "budget" });
const row = (id) => comparison.find((r) => r.id === id);

near("YTD net revenue vs budget", row("net_revenue").deltaPct, -0.029, 0.002);
check("revenue below plan is unfavourable", row("net_revenue").favourable === false);
check(
  "discounts above plan are unfavourable, not a gain",
  row("discounts").delta > 0 && row("discounts").favourable === false
);
// COGS is the case worth being careful about. In euros it came in under
// plan, because we sold fewer cases than we intended to -- genuinely
// favourable. As a share of net revenue it is well over plan, because each
// case cost more than the budget assumed. Reporting only one of the two
// would tell half the story, and the wrong half.
check(
  "COGS under plan in euros reads favourable",
  row("cogs").delta < 0 && row("cogs").favourable === true
);
check(
  "the same COGS reads unfavourable as a share of net revenue",
  row("cogs").shareVariance.points > 0.01 &&
    row("cogs").shareVariance.favourable === false
);
check(
  "direct commercial costs below plan are favourable",
  row("opex_direct").delta < 0 && row("opex_direct").favourable === true
);
check(
  "gross margin erosion is measured in points",
  row("gross_profit").shareVariance.points < 0 &&
    row("gross_profit").shareVariance.favourable === false
);

const drivers = varianceBy(dataset, YTD("cy_actual"), {
  against: "budget",
  rowId: "net_revenue",
  dimension: "category",
});
check("drivers are ranked by the size of the gap", Math.abs(drivers[0].delta) >= Math.abs(drivers[4].delta));
check("dairy is the largest driver of the miss", drivers[0].key === "dairy");

const series = monthlySeries(dataset, FY("cy_actual"), "net_revenue");
check("a monthly series covers all twelve months", series.length === 12);
near(
  "the monthly series adds back to the full year",
  series.reduce((sum, point) => sum + point.value, 0),
  fy.value("net_revenue"),
  1
);

// ---------------------------------------------------------------------------
// 7. Bridges tie
// ---------------------------------------------------------------------------

const ebitdaBridge = pnlBridge(dataset, {
  from: "budget",
  to: "cy_actual",
  filters: {},
  target: "ebitda",
});
check("the EBITDA bridge is available at group level", ebitdaBridge.available);
check("the EBITDA bridge ties", Math.abs(ebitdaBridge.residual) < 1);
near(
  "the EBITDA bridge starts at budget",
  ebitdaBridge.start / M,
  63.8,
  0.06
);
near("the EBITDA bridge ends at actual", ebitdaBridge.end / M, 56.9, 0.06);
check(
  "a customer scoped EBITDA bridge refuses rather than lying",
  pnlBridge(dataset, {
    from: "budget",
    to: "cy_actual",
    filters: { customers: ["ipervia"] },
    target: "ebitda",
  }).available === false
);
check(
  "a customer scoped contribution bridge still works",
  pnlBridge(dataset, {
    from: "budget",
    to: "cy_actual",
    filters: { customers: ["ipervia"] },
    target: "contribution_margin",
  }).available === true
);

for (const segmentBy of ["category", "customer", "channel"]) {
  const pvm = priceVolumeMixBridge(dataset, {
    from: "budget",
    to: "cy_actual",
    segmentBy,
  });
  check(`the price/volume/mix bridge ties by ${segmentBy}`, Math.abs(pvm.residual) < 1);
  near(
    `the ${segmentBy} bridge lands on actual net revenue`,
    pvm.end / M,
    349.3,
    0.06
  );
}

const pvm = priceVolumeMixBridge(dataset, {
  from: "ly_actual",
  to: "cy_actual",
  segmentBy: "category",
});
const step = (id) => pvm.steps.find((s) => s.id === id).value;
check("the price increase shows as a positive list price effect", step("gross_price") > 0);
check("deeper discounting shows as a negative discount effect", step("discount") < 0);
check(
  "the bridge explains the whole movement",
  Math.abs(pvm.start + pvm.steps.reduce((t, s) => t + s.value, 0) - pvm.end) < 1
);

const contribution = contributionBridge(dataset, {
  from: "budget",
  to: "cy_actual",
  rowId: "net_revenue",
  dimension: "channel",
});
near(
  "the channel contribution bridge ties",
  contribution.steps.reduce((t, s) => t + s.value, 0),
  contribution.delta,
  1
);
check(
  "the discount channel is the only one ahead of plan",
  contribution.steps.filter((s) => s.value > 0).length === 1 &&
    contribution.steps.find((s) => s.value > 0).key === "discount"
);

// ---------------------------------------------------------------------------
// 8. The forecast respects what is already booked
// ---------------------------------------------------------------------------

const closedActual = ladder(dataset, YTD("cy_actual"));
const closedForecast = ladder(dataset, YTD("forecast"));
near(
  "the forecast does not restate closed months",
  closedForecast.value("net_revenue"),
  closedActual.value("net_revenue"),
  0.01
);
const openForecast = ladder(dataset, {
  scenario: "forecast",
  months: { from: dataset.lastClosedMonth + 1, to: 12 },
});
check("the forecast still has open months to speak to", openForecast.value("net_revenue") > 0);

// ---------------------------------------------------------------------------

console.log(`\n${passed} checks passed`);
if (failures.length) {
  console.log(`${failures.length} FAILED:\n`);
  for (const failure of failures) console.log(`  x ${failure}`);
  process.exitCode = 1;
} else {
  console.log("no failures\n");
}
