/**
 * Variance between two scenarios.
 *
 * The one rule that matters here: a bigger number is not automatically good
 * news. Revenue above plan is favourable, COGS above plan is not. Every
 * variance therefore carries a `favourable` flag derived from the sign of
 * the line, so a chart can colour it without re-deriving the logic and
 * without ever painting a cost overrun green.
 */

import { ladder, ladderBy, monthlySeries } from "./aggregate.js";
import { ratio } from "./metrics.js";

/**
 * Compare one figure against a reference.
 * @param {number|null} actual
 * @param {number|null} reference
 * @param {number} sign +1 for income lines, -1 for cost lines
 */
export function variance(actual, reference, sign = 1) {
  if (actual === null || reference === null) {
    return {
      actual,
      reference,
      delta: null,
      deltaPct: null,
      favourable: null,
      available: false,
    };
  }
  const delta = actual - reference;
  return {
    actual,
    reference,
    delta,
    // Measured against the magnitude of the reference, so a cost line does
    // not report a negative percentage for coming in under plan.
    deltaPct: ratio(delta, Math.abs(reference)),
    favourable: delta === 0 ? null : sign > 0 ? delta > 0 : delta < 0,
    available: true,
  };
}

/** Difference between two ratios, in percentage points. */
export function pointsVariance(actual, reference, higherIsBetter = true) {
  if (actual === null || reference === null) {
    return { actual, reference, points: null, favourable: null, available: false };
  }
  const points = actual - reference;
  return {
    actual,
    reference,
    points,
    favourable: points === 0 ? null : higherIsBetter ? points > 0 : points < 0,
    available: true,
  };
}

/**
 * The full P&L ladder for one scenario against another.
 * Returns one row per ladder line, carrying both values and the variance.
 */
export function compareLadders(dataset, filters, { against }) {
  const actual = ladder(dataset, filters);
  const reference = ladder(dataset, { ...filters, scenario: against });

  return dataset.ladderRows.map((row) => {
    const sign = dataset.signOf(row.id);
    const result = variance(
      actual.value(row.id),
      reference.value(row.id),
      sign
    );
    const actualRow = actual.get(row.id);
    const referenceRow = reference.get(row.id);
    return {
      id: row.id,
      label: row.label,
      type: row.type,
      emphasis: row.emphasis,
      sign,
      ...result,
      // Margin lines are read in percentage points, not percentages of a
      // percentage, so carry that comparison alongside.
      shareVariance: pointsVariance(
        actualRow.shareOfNetRevenue,
        referenceRow.shareOfNetRevenue,
        sign > 0
      ),
    };
  });
}

/**
 * Variance of one ladder row, broken down by a dimension and ranked by the
 * size of the gap. This is the "who is driving the miss" view.
 */
export function varianceBy(dataset, filters, { against, rowId, dimension }) {
  const sign = dataset.signOf(rowId);
  const actual = new Map(
    ladderBy(dataset, filters, dimension).map((e) => [e.key, e])
  );
  const reference = new Map(
    ladderBy(dataset, { ...filters, scenario: against }, dimension).map((e) => [
      e.key,
      e,
    ])
  );

  const rows = [];
  for (const [key, entry] of actual) {
    const result = variance(
      entry.ladder.value(rowId),
      reference.get(key)?.ladder.value(rowId) ?? null,
      sign
    );
    rows.push({ key, label: entry.label, ...result });
  }
  // Largest absolute gap first: the point of the view is to surface the
  // drivers, not to preserve dimension order.
  rows.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
  return rows;
}

/** Monthly variance of one ladder row, for a phasing chart. */
export function monthlyVariance(dataset, filters, { against, rowId }) {
  const sign = dataset.signOf(rowId);
  const actual = monthlySeries(dataset, filters, rowId);
  const reference = monthlySeries(
    dataset,
    { ...filters, scenario: against },
    rowId
  );
  return actual.map((point, i) => ({
    month: point.month,
    label: point.label,
    ...variance(point.value, reference[i].value, sign),
  }));
}

/**
 * Every scenario side by side for one ladder row: the four column read a
 * finance audience expects before any chart is drawn.
 */
export function scenarioComparison(dataset, filters, rowId) {
  const sign = dataset.signOf(rowId);
  const values = new Map(
    dataset.scenarioIds.map((id) => [
      id,
      ladder(dataset, { ...filters, scenario: id }).value(rowId),
    ])
  );
  return dataset.meta.scenarios.map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    value: values.get(scenario.id),
    vsBudget:
      scenario.id === "budget"
        ? null
        : variance(values.get(scenario.id), values.get("budget"), sign),
    vsLastYear:
      scenario.id === "ly_actual"
        ? null
        : variance(values.get(scenario.id), values.get("ly_actual"), sign),
  }));
}
