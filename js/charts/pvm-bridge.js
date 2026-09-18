/**
 * Price, volume and mix: what the revenue movement is made of.
 *
 * Net revenue moved because we sold a different number of cases, because
 * we sold a different blend of them, because the list price changed, and
 * because we gave a different discount back. The logic layer separates the
 * four under a stated convention and returns the residual, so this chart can
 * assert the bridge ties before drawing it.
 *
 * Steps only, like every bridge on the page. The segment the mix effect is
 * measured over -- category or customer -- is a choice, and the card says
 * which one is in force.
 */

import { priceVolumeMixBridge } from "../logic/index.js";
import { chartModule, emptyState } from "./theme.js";
import { bridgeBars, renderWaterfall } from "./waterfall.js";

export function createPvmBridge(dataset, canvas) {
  return chartModule(canvas, (ctx, c) => {
    if (!ctx.compare) {
      emptyState(canvas, "Turn on a comparison to split the revenue movement into price, volume and mix.");
      return { available: false, reason: "no-compare" };
    }
    emptyState(canvas, null);

    const bridge = priceVolumeMixBridge(dataset, {
      from: ctx.compare,
      to: ctx.primary,
      filters: ctx.filters,
      segmentBy: ctx.state.pvmSegment,
    });

    // Every effect here is a revenue effect, so up is good.
    const steps = bridge.steps.map((s) => ({
      label: s.label,
      value: s.value,
      favourable: s.value === 0 ? null : s.value > 0,
    }));
    const bars = bridgeBars(c, bridge.start, steps);
    const chart = renderWaterfall(canvas, c, bars, { mode: "bridge" });

    return { chart, available: true, bridge };
  });
}
