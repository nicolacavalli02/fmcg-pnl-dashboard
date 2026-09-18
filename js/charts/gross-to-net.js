/**
 * Where the list price goes before it reaches the top line.
 *
 * A structural waterfall: gross sales stands as a full bar, each discount
 * line hangs off the one before it, and net revenue stands at the end. The
 * totals are drawn from zero because they are levels, and the steps are
 * large enough relative to the whole -- a quarter of gross sales in all --
 * that the zero baseline costs nothing. This is the chart a commercial
 * finance team argues over: which of the four lines is growing.
 */

import { ladderWaterfall } from "../logic/index.js";
import { money, percent } from "../ui/format.js";
import { chartModule, tint } from "./theme.js";
import { renderWaterfall } from "./waterfall.js";

export function createGrossToNet(dataset, canvas) {
  return chartModule(canvas, (ctx, c) => {
    const steps = ladderWaterfall(dataset, ctx.ladder, { to: "net_revenue", detail: true });
    const gross = steps[0].end;
    const primaryColour = c.scenario[ctx.primary];

    const bars = steps.map((s) => ({
      label: s.label.replace(" & Credit Notes", "").replace("Trade Spend", "trade spend"),
      start: s.start,
      end: s.end,
      delta: s.delta,
      isTotal: s.isTotal,
      // Money given away is neither good nor bad in itself; it is drawn in a
      // quiet slate so the two levels it sits between carry the colour.
      colour: s.isTotal ? primaryColour : tint(primaryColour, 0.55),
      note: s.isTotal ? "" : `${percent(s.value / gross)} of gross sales`,
    }));

    const chart = renderWaterfall(canvas, c, bars, {
      mode: "structural",
      valueText: (i) => {
        const b = bars[i];
        if (b.isTotal) return money(b.end).replace("m", "");
        return `−${money(Math.abs(b.delta)).replace("m", "")}`;
      },
      footer: (i) => (bars[i].isTotal ? null : bars[i].note),
    });

    return {
      chart,
      steps,
      grossSales: gross,
      netRevenue: steps[steps.length - 1].end,
      grossToNet: 1 - steps[steps.length - 1].end / gross,
    };
  });
}
