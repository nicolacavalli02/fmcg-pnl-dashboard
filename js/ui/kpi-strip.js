/**
 * The headline tiles.
 *
 * Six figures, each with its movement against whatever the comparison slicer
 * is set to. The tiles that cannot be answered at the current grain say so
 * and explain why on hover, rather than showing a zero that would look like
 * a real result.
 */

import { metricsFrom, pointsVariance, variance } from "../logic/index.js";
import { cases, money, NOT_AVAILABLE, percent, points, varianceClass } from "./format.js";

const UNAVAILABLE_REASON =
  "Overhead is held per category, not per customer, so this cannot be " +
  "stated once the view is filtered below group level.";

export function createKpiStrip(dataset, root) {
  return {
    render(ctx) {
      const current = metricsFrom(dataset, ctx.ladder);
      const reference = metricsFrom(dataset, ctx.referenceLadder);

      const tiles = [
        {
          label: "Net revenue",
          value: money(current.netRevenue),
          delta: variance(current.netRevenue, reference.netRevenue, 1),
          format: (v) => percent(v.deltaPct, { signed: true }),
        },
        {
          label: "Volume",
          value: cases(current.volumeTotal),
          delta: variance(current.volumeTotal, reference.volumeTotal, 1),
          format: (v) => percent(v.deltaPct, { signed: true }),
        },
        {
          label: "Gross-to-net",
          // A bigger share of the list price given away is worse, so this one
          // reads the other way round.
          value: percent(current.grossToNetPct),
          delta: pointsVariance(
            current.grossToNetPct,
            reference.grossToNetPct,
            false
          ),
          format: (v) => points(v.points),
        },
        {
          label: "Gross margin",
          value: percent(current.grossMarginPct),
          delta: pointsVariance(
            current.grossMarginPct,
            reference.grossMarginPct,
            true
          ),
          format: (v) => points(v.points),
        },
        {
          label: "Contribution margin",
          value: money(current.contributionMargin),
          delta: variance(
            current.contributionMargin,
            reference.contributionMargin,
            1
          ),
          format: (v) => percent(v.deltaPct, { signed: true }),
        },
        {
          label: "EBITDA",
          value: money(current.ebitda),
          delta: variance(current.ebitda, reference.ebitda, 1),
          format: (v) => percent(v.deltaPct, { signed: true }),
          reason: UNAVAILABLE_REASON,
        },
      ];

      root.replaceChildren(
        ...tiles.map((tile) => {
          const el = document.createElement("div");
          el.className = "kpi";

          const label = document.createElement("p");
          label.className = "kpi-label";
          label.textContent = tile.label;

          const value = document.createElement("p");
          value.className = "kpi-value";
          value.textContent = tile.value;

          const delta = document.createElement("p");
          delta.className = "kpi-delta";

          if (tile.value === NOT_AVAILABLE) {
            el.classList.add("is-unavailable");
            value.textContent = NOT_AVAILABLE;
            delta.textContent = "not at this grain";
            if (tile.reason) el.title = tile.reason;
          } else if (tile.delta.available) {
            delta.textContent = tile.format(tile.delta);
            delta.classList.add(varianceClass(tile.delta.favourable));
          } else {
            delta.textContent = "";
          }

          el.append(label, value, delta);
          return el;
        })
      );
    },
  };
}
