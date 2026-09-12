/**
 * Bridges: the waterfall values that explain a movement between two
 * scenarios, rather than merely showing both.
 *
 * Two bridges live here.
 *
 * The P&L bridge walks from one scenario result to another through the cost
 * blocks, and is arithmetic: every group either adds to or subtracts from
 * the subtotal, so the steps tie exactly.
 *
 * The price/volume/mix bridge is the one that earns its keep. Net revenue
 * moved because we sold a different number of cases, because we sold a
 * different blend of them, and because each case realised a different price.
 * Those three are not separable without a convention, so the one used here
 * is stated explicitly below and the residual is returned so a chart can
 * prove the decomposition ties.
 */

import { aggregateBy, ladder, normaliseFilters, resolveLadder } from "./aggregate.js";

/**
 * Volume, mix and price effects on net revenue between two scenarios.
 *
 * With segments s, volume V and net price per case P:
 *
 *   volume = (V1 - V0) x P0avg          all segments growing evenly
 *   mix    = SUM(V1s x P0s) - V1 x P0avg  the blend shifting between them
 *   price  = SUM(V1s x (P1s - P0s))     what each case realised
 *
 * These sum exactly to R1 - R0. Volume is valued at last period average
 * price and mix carries the rest of the quantity story, which is the
 * standard convention: it keeps the volume effect readable as "same
 * business, more cases" and puts every compositional shift in one place.
 *
 * The price effect is split further into the list price we charged and the
 * discount we gave back, since in FMCG those are two different decisions
 * taken by two different people.
 */
export function priceVolumeMixBridge(
  dataset,
  { from, to, filters = {}, segmentBy = "category" }
) {
  const segmentsFor = (scenario) => {
    const map = new Map();
    const buckets = aggregateBy(
      dataset,
      { ...filters, scenario },
      segmentBy
    );
    for (const [key, totals] of buckets) {
      if (key === null) continue;
      const resolved = resolveLadder(dataset, totals, true);
      const volume =
        (resolved.value("volume_baseline") ?? 0) +
        (resolved.value("volume_incremental") ?? 0);
      if (volume === 0) continue;
      map.set(key, {
        volume,
        netRevenue: resolved.value("net_revenue") ?? 0,
        grossSales: resolved.value("gross_sales") ?? 0,
        discounts: resolved.value("discounts") ?? 0,
      });
    }
    return map;
  };

  const base = segmentsFor(from);
  const current = segmentsFor(to);

  const sum = (map, field) => {
    let total = 0;
    for (const entry of map.values()) total += entry[field];
    return total;
  };

  const volume0 = sum(base, "volume");
  const volume1 = sum(current, "volume");
  const revenue0 = sum(base, "netRevenue");
  const revenue1 = sum(current, "netRevenue");
  const averagePrice0 = volume0 ? revenue0 / volume0 : 0;

  let mix = -volume1 * averagePrice0;
  let grossPriceEffect = 0;
  let discountEffect = 0;

  for (const [key, now] of current) {
    const before = base.get(key);
    // A segment with no history has no price to compare against, so it is
    // valued at the average and shows up as mix rather than as a phantom
    // price movement.
    const netPrice0 = before ? before.netRevenue / before.volume : averagePrice0;
    const grossPrice0 = before ? before.grossSales / before.volume : 0;
    const discountPerCase0 = before ? before.discounts / before.volume : 0;

    mix += now.volume * netPrice0;
    if (before) {
      grossPriceEffect +=
        now.volume * (now.grossSales / now.volume - grossPrice0);
      discountEffect -=
        now.volume * (now.discounts / now.volume - discountPerCase0);
    }
  }

  const volumeEffect = (volume1 - volume0) * averagePrice0;
  const steps = [
    { id: "volume", label: "Volume", value: volumeEffect },
    { id: "mix", label: "Mix", value: mix },
    { id: "gross_price", label: "List price", value: grossPriceEffect },
    { id: "discount", label: "Discounts & trade spend", value: discountEffect },
  ];
  const explained = steps.reduce((total, step) => total + step.value, 0);

  return {
    from,
    to,
    segmentBy,
    start: revenue0,
    end: revenue1,
    delta: revenue1 - revenue0,
    steps,
    // Should be zero to floating point. Exposed rather than hidden so a
    // chart can assert the bridge actually ties.
    residual: revenue1 - revenue0 - explained,
    volumeStart: volume0,
    volumeEnd: volume1,
  };
}

/**
 * Walk from one scenario to another through the P&L, down to `target`.
 *
 * Each cost or income group contributes its movement times its sign, so the
 * steps add up to the change in the target subtotal exactly.
 */
export function pnlBridge(
  dataset,
  { from, to, filters = {}, target = "ebitda" }
) {
  const base = ladder(dataset, { ...filters, scenario: from });
  const current = ladder(dataset, { ...filters, scenario: to });

  const start = base.value(target);
  const end = current.value(target);
  if (start === null || end === null) {
    // Happens when the view is scoped to a customer and the target sits
    // below contribution margin: the overhead simply is not there to bridge.
    return { from, to, target, available: false, steps: [] };
  }

  const steps = [];
  for (const row of dataset.ladderRows) {
    if (row.id === target) break;
    if (row.type !== "group") continue;
    const sign = dataset.signOf(row.id);
    const delta = (current.value(row.id) ?? 0) - (base.value(row.id) ?? 0);
    steps.push({
      id: row.id,
      label: row.label,
      sign,
      delta,
      // The contribution to the target: a cost going up pushes it down.
      value: sign * delta,
      favourable: delta === 0 ? null : sign > 0 ? delta > 0 : delta < 0,
    });
  }

  const explained = steps.reduce((total, step) => total + step.value, 0);
  return {
    from,
    to,
    target,
    available: true,
    start,
    end,
    delta: end - start,
    steps,
    residual: end - start - explained,
  };
}

/**
 * Contribution of each member of a dimension to a movement in one row.
 * Ranked by size, so the chart shows who moved the number, not who exists.
 */
export function contributionBridge(
  dataset,
  { from, to, filters = {}, rowId = "net_revenue", dimension = "category" }
) {
  const valuesFor = (scenario) => {
    const map = new Map();
    const buckets = aggregateBy(dataset, { ...filters, scenario }, dimension);
    for (const [key, totals] of buckets) {
      if (key === null) continue;
      map.set(key, resolveLadder(dataset, totals, true).value(rowId) ?? 0);
    }
    return map;
  };

  const base = valuesFor(from);
  const current = valuesFor(to);
  const keys = new Set([...base.keys(), ...current.keys()]);

  const steps = [];
  for (const key of keys) {
    steps.push({
      key,
      value: (current.get(key) ?? 0) - (base.get(key) ?? 0),
    });
  }
  steps.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  const start = [...base.values()].reduce((t, v) => t + v, 0);
  const end = [...current.values()].reduce((t, v) => t + v, 0);
  return { from, to, rowId, dimension, start, end, delta: end - start, steps };
}

/** Guard used by the checks: filters must name a scenario per call. */
export function assertFilters(filters) {
  return normaliseFilters(filters);
}
