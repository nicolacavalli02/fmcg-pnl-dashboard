/**
 * Public surface of the logic layer.
 *
 * Charts and page code import from here, never from the individual modules,
 * so the internal split can change without touching every call site.
 *
 * Typical use:
 *
 *   import { loadDataset, ladder, metrics, pnlBridge } from "./js/logic/index.js";
 *
 *   const data = await loadDataset();
 *   const ytd = { scenario: "cy_actual", months: { from: 1, to: 8 } };
 *   const pnl = ladder(data, ytd);            // the full ladder
 *   const kpi = metrics(data, ytd);           // margins, promo, share
 *   const bridge = pnlBridge(data, {          // why EBITDA missed plan
 *     from: "budget", to: "cy_actual", filters: ytd,
 *   });
 */

export { loadDataset, createDataset, dimensionMembers, dimensionKey } from "./dataset.js";

export {
  normaliseFilters,
  factMatches,
  aggregate,
  aggregateBy,
  resolveLadder,
  ladder,
  ladderBy,
  monthlySeries,
  cumulativeSeries,
  closedMonths,
  openMonths,
} from "./aggregate.js";

export { ratio, metricsFrom, metrics, averageListPrice } from "./metrics.js";

export {
  variance,
  pointsVariance,
  compareLadders,
  varianceBy,
  monthlyVariance,
  scenarioComparison,
} from "./variance.js";

export {
  priceVolumeMixBridge,
  pnlBridge,
  contributionBridge,
} from "./bridge.js";
