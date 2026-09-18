/**
 * Why the result moved: a bridge from the comparison scenario to the one
 * being read, through the P&L blocks. Steps only -- see waterfall.js for why
 * a bridge never draws its totals as bars.
 *
 * The target adapts: EBITDA at group level, contribution margin once a
 * customer filter puts the overhead out of reach. Without a comparison there
 * is nothing to bridge, and the card says so instead of drawing against a
 * default the masthead does not claim.
 */

import { pnlBridge } from "../logic/index.js";
import { chartModule, emptyState } from "./theme.js";
import { bridgeBars, renderWaterfall } from "./waterfall.js";

export function createVarianceBridge(dataset, canvas) {
  return chartModule(canvas, (ctx, c) => {
    if (!ctx.compare) {
      emptyState(canvas, "Turn on a comparison to see what moved the result.");
      return { available: false, reason: "no-compare" };
    }

    const bridge = pnlBridge(dataset, {
      from: ctx.compare,
      to: ctx.primary,
      filters: ctx.filters,
      target: ctx.bridgeTarget,
    });
    if (!bridge.available) {
      emptyState(canvas, "Not available at this grain.");
      return { available: false, reason: "grain", bridge };
    }
    emptyState(canvas, null);

    const bars = bridgeBars(c, bridge.start, bridge.steps);
    const chart = renderWaterfall(canvas, c, bars, { mode: "bridge" });
    return { chart, available: true, bridge };
  });
}
