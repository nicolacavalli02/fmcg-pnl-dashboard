/**
 * Do the promotions pay back?
 *
 * One bubble per category: how much of its volume goes out on promotion
 * (across), how much margin each promotional euro earns back (up), and how
 * much is spent (size). The dashed line at 1.0 is break-even: below it a
 * promotion gives away more margin than it brings in. The interesting
 * quadrant is bottom-right -- heavily promoted and not paying back -- and
 * in this dataset that is where Dairy sits.
 *
 * Every figure is derived from the base measures: the split of volume into
 * baseline, incremental and on-promotion is what makes pressure and return
 * separately answerable.
 */

import { metricsBy } from "../logic/index.js";
import { money, percent, times } from "../ui/format.js";
import { SCENARIO_SHORT } from "../state.js";
import { axisX, axisY, baseOptions, chartModule, emptyState, referenceLine, tooltip, tint } from "./theme.js";

function pointLabels(c, points) {
  return {
    id: "bubbleLabels",
    afterDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(0);
      const { ctx } = chart;
      ctx.save();
      ctx.font = "500 11px 'IBM Plex Sans', system-ui, sans-serif";
      ctx.fillStyle = c.ink;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      meta.data.forEach((el, i) => {
        const r = el.options.radius ?? 6;
        ctx.fillText(points[i].label, el.x + r + 5, el.y);
      });
      ctx.restore();
    },
  };
}

export function createPromoReturn(dataset, canvas) {
  return chartModule(canvas, (ctx, c) => {
    const current = metricsBy(dataset, ctx.filters, "category").filter(
      (e) => e.metrics.promoROI !== null && e.metrics.promoPressurePct !== null
    );
    if (!current.length) {
      emptyState(canvas, "No promotional volume in this slice.");
      return { points: [] };
    }
    emptyState(canvas, null);

    const reference = ctx.compare
      ? new Map(metricsBy(dataset, ctx.referenceFilters, "category").map((e) => [e.key, e.metrics]))
      : null;

    const maxSpend = Math.max(...current.map((e) => e.metrics.promoSpend));
    const points = current.map((e) => ({
      key: e.key,
      label: e.label,
      x: e.metrics.promoPressurePct * 100,
      y: e.metrics.promoROI,
      r: 6 + 20 * Math.sqrt(e.metrics.promoSpend / maxSpend),
      spend: e.metrics.promoSpend,
      incremental: e.metrics.incrementalSharePct,
      referenceROI: reference?.get(e.key)?.promoROI ?? null,
    }));

    const colour = c.scenario[ctx.primary];
    const chart = new Chart(canvas.getContext("2d"), {
      type: "bubble",
      data: {
        datasets: [
          {
            data: points,
            backgroundColor: tint(colour, 0.35),
            borderColor: colour,
            borderWidth: 1.5,
            hoverBorderWidth: 2,
          },
        ],
      },
      options: {
        ...baseOptions(),
        layout: { padding: { right: 84, top: 10 } },
        plugins: {
          legend: { display: false },
          tooltip: tooltip(c, {
            callbacks: {
              title: (items) => points[items[0].dataIndex].label,
              label: (item) => {
                const p = points[item.dataIndex];
                return [
                  `Return ${times(p.y)}x on ${money(p.spend)} of promotional spend`,
                  `${percent(p.x / 100)} of volume on promotion, ${percent(p.incremental)} incremental`,
                ];
              },
              footer: (items) => {
                const p = points[items[0].dataIndex];
                return p.referenceROI === null
                  ? ""
                  : `${SCENARIO_SHORT[ctx.compare]}: ${times(p.referenceROI)}x`;
              },
            },
          }),
        },
        scales: {
          x: axisX(c, {
            title: { display: true, text: "Volume sold on promotion", color: c.inkSoft, font: { size: 11 } },
            beginAtZero: true,
            ticks: { color: c.inkSoft, font: { size: 11 }, callback: (v) => `${v}%` },
          }),
          y: axisY(c, {
            title: { display: true, text: "Margin earned per € of promotional spend", color: c.inkSoft, font: { size: 11 } },
            beginAtZero: true,
            suggestedMax: 1.2,
            ticks: { color: c.inkSoft, font: { size: 11 }, padding: 8, callback: (v) => `${v.toFixed(1)}x` },
          }),
        },
      },
      plugins: [referenceLine(c, 1, "break-even"), pointLabels(c, points)],
    });

    return { chart, points };
  });
}
