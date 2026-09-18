/**
 * The headline figures: one ruled band, six readings.
 *
 * Each reading carries its movement against whatever the comparison control
 * is set to, and carries nothing when the comparison is off -- a figure
 * with no reference has no delta, and inventing one against the default
 * would contradict the masthead. Readings that cannot be answered at the
 * current grain say so and explain why on hover, rather than showing a zero
 * that would look like a real result.
 */

import { metricsFrom, pointsVariance, variance } from "../logic/index.js";
import { SCENARIO_SHORT } from "../state.js";
import { cases, money, NOT_AVAILABLE, percent, points, varianceClass } from "./format.js";

const UNAVAILABLE_REASON =
  "Overhead is held per category, not per customer, so this cannot be " +
  "stated once the view is filtered below group level.";

export function createKpiStrip(dataset, root) {
  return {
    render(ctx) {
      const current = metricsFrom(dataset, ctx.ladder);
      const reference = ctx.referenceLadder ? metricsFrom(dataset, ctx.referenceLadder) : null;
      const vs = ctx.compare ? `vs ${SCENARIO_SHORT[ctx.compare]}` : "";

      const abs = (key) => ({
        delta: reference ? variance(current[key], reference[key], 1) : null,
        format: (v) => percent(v.deltaPct, { signed: true }),
      });
      const pts = (key, higherIsBetter) => ({
        delta: reference ? pointsVariance(current[key], reference[key], higherIsBetter) : null,
        format: (v) => points(v.points),
      });

      const tiles = [
        { label: "Net revenue", value: money(current.netRevenue), ...abs("netRevenue") },
        { label: "Volume", value: cases(current.volumeTotal), unit: "cases", ...abs("volumeTotal") },
        // A bigger share of the list price given away is worse, so this one
        // reads the other way round.
        { label: "Gross-to-net", value: percent(current.grossToNetPct), ...pts("grossToNetPct", false) },
        { label: "Gross margin", value: percent(current.grossMarginPct), ...pts("grossMarginPct", true) },
        {
          label: "Contribution margin",
          value: money(current.contributionMargin),
          ...abs("contributionMargin"),
        },
        {
          label: "EBITDA",
          value: money(current.ebitda),
          ...abs("ebitda"),
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
          if (tile.unit && tile.value !== NOT_AVAILABLE) {
            const unit = document.createElement("span");
            unit.className = "kpi-unit";
            unit.textContent = ` ${tile.unit}`;
            value.append(unit);
          }

          const delta = document.createElement("p");
          delta.className = "kpi-delta";

          if (tile.value === NOT_AVAILABLE) {
            el.classList.add("is-unavailable");
            delta.textContent = "not at this grain";
            if (tile.reason) el.title = tile.reason;
          } else if (tile.delta?.available) {
            delta.textContent = `${tile.format(tile.delta)} ${vs}`;
            delta.classList.add(varianceClass(tile.delta.favourable));
          } else {
            delta.textContent = "";
            delta.classList.add("is-empty");
          }

          el.append(label, value, delta);
          return el;
        })
      );
    },
  };
}
