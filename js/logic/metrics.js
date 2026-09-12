/**
 * Derived commercial and financial metrics.
 *
 * Nothing in this file is stored in the dataset: every ratio here is built
 * from the base measures so the dashboard can change its mind about what to
 * show without the data being regenerated.
 *
 * A metric returns null rather than zero when the data underneath it is out
 * of reach -- EBITDA margin under a customer filter, market share when the
 * view is scoped below category level. Null means "cannot be answered here",
 * which is a different statement from zero and should be rendered as such.
 */

import { factMatches, ladder, normaliseFilters } from "./aggregate.js";

/** Divide, but return null instead of Infinity or NaN. */
export function ratio(numerator, denominator) {
  if (numerator === null || denominator === null) return null;
  if (!denominator) return null;
  return numerator / denominator;
}

/**
 * Every headline metric for one resolved ladder.
 * @param {object} resolved the object returned by ladder() / resolveLadder()
 */
export function metricsFrom(dataset, resolved) {
  const v = (id) => resolved.value(id);

  const grossSales = v("gross_sales");
  const netRevenue = v("net_revenue");
  const grossProfit = v("gross_profit");

  const volumeBaseline = v("volume_baseline") ?? 0;
  const volumeIncremental = v("volume_incremental") ?? 0;
  const volumeOnPromo = v("volume_on_promo") ?? 0;
  const volumeTotal = volumeBaseline + volumeIncremental;

  const promoSpend = v("trade_spend_promo") ?? 0;
  const tradeSpend = promoSpend + (v("trade_spend_other") ?? 0);

  // Margin earned on one extra case. Gross profit is the right basis: it is
  // the variable margin the incremental volume actually brings in, before
  // the fixed commercial costs that a promotion does not move.
  const grossProfitPerCase = ratio(grossProfit, volumeTotal);

  return {
    // --- absolutes -------------------------------------------------------
    grossSales,
    netRevenue,
    grossProfit,
    contributionMargin: v("contribution_margin"),
    ebitda: v("ebitda"),
    ebit: v("ebit"),
    discounts: v("discounts"),
    cogs: v("cogs"),
    tradeSpend,
    promoSpend,

    // --- margins, as a share of net revenue ------------------------------
    grossMarginPct: ratio(grossProfit, netRevenue),
    contributionMarginPct: ratio(v("contribution_margin"), netRevenue),
    ebitdaMarginPct: ratio(v("ebitda"), netRevenue),
    ebitMarginPct: ratio(v("ebit"), netRevenue),

    // --- the commercial block, all measured on gross sales ---------------
    // Gross-to-net is the single most quoted FMCG ratio: how much of the
    // list price never reaches the top line.
    grossToNetPct: ratio(v("discounts"), grossSales),
    onInvoicePct: ratio(v("discount_on_invoice"), grossSales),
    tradeSpendPct: ratio(tradeSpend, grossSales),
    promoSpendPct: ratio(promoSpend, grossSales),

    // --- volume and price ------------------------------------------------
    volumeTotal,
    volumeBaseline,
    volumeIncremental,
    volumeOnPromo,
    grossPricePerCase: ratio(grossSales, volumeTotal),
    netPricePerCase: ratio(netRevenue, volumeTotal),
    cogsPerCase: ratio(v("cogs"), volumeTotal),
    grossProfitPerCase,

    // --- promotional read --------------------------------------------------
    // Pressure is how much of the business goes out under promotion;
    // incremental share is how much of it the promotion actually created.
    // The gap between the two is baseline volume that was discounted anyway.
    promoPressurePct: ratio(volumeOnPromo, volumeTotal),
    incrementalSharePct: ratio(volumeIncremental, volumeTotal),
    // Below 1.0 the promotion gave away more margin than it earned back.
    promoROI:
      grossProfitPerCase === null
        ? null
        : ratio(volumeIncremental * grossProfitPerCase, promoSpend),

    // --- market ------------------------------------------------------------
    // Unavailable below category level: the market is not held per customer.
    marketShareVolumePct: ratio(volumeTotal, v("market_volume")),
    marketShareValuePct: ratio(netRevenue, v("market_value")),
  };
}

/** Aggregate and compute metrics in one call. */
export function metrics(dataset, filters) {
  return metricsFrom(dataset, ladder(dataset, filters));
}

/**
 * Average list price per case under a filter, weighted by volume.
 *
 * List price lives outside the fact table because it is not additive, so it
 * cannot be summed like a P&L line -- it has to be weighted by the volume
 * sold at each price. The gap between this and netPricePerCase is the whole
 * gross-to-net story expressed per case.
 */
export function averageListPrice(dataset, filters) {
  const f = normaliseFilters(filters);
  let weighted = 0;
  let cases = 0;
  for (const fact of dataset.factsFor(f.scenario)) {
    if (fact.line !== "volume_baseline" && fact.line !== "volume_incremental") {
      continue;
    }
    if (!factMatches(dataset, fact, f)) continue;
    weighted += dataset.listPrice(f.scenario, fact.category, fact.month) * fact.value;
    cases += fact.value;
  }
  return ratio(weighted, cases);
}
