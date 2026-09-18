/**
 * What a case is worth by channel: list price, what was invoiced, what was
 * kept.
 *
 * The gross-to-net ratio expressed in the unit a commercial team argues in.
 * Three bars per channel, all levels, all from zero. The gap from list to
 * gross is the channel's price positioning; the gap from gross to net is the
 * discount it negotiates. Discount prices low and discounts little,
 * Modern Trade prices high and gives a quarter of it back, and the two end
 * up closer than either looks.
 */

import { averageListPrice, metrics } from "../logic/index.js";
import { perCase } from "../ui/format.js";
import { axisX, axisY, barLabels, baseOptions, chartModule, emptyState, tint, tooltip } from "./theme.js";

export function createRealisation(dataset, canvas) {
  return chartModule(canvas, (ctx, c) => {
    const wanted = ctx.filters.channels.length
      ? dataset.meta.channels.filter((ch) => ctx.filters.channels.includes(ch.id))
      : dataset.meta.channels;

    const rows = wanted
      .map((ch) => {
        const filters = { ...ctx.filters, channels: [ch.id] };
        const m = metrics(dataset, filters);
        return {
          label: ch.label,
          list: averageListPrice(dataset, filters),
          gross: m.grossPricePerCase,
          net: m.netPricePerCase,
          cost: m.cogsPerCase,
        };
      })
      .filter((r) => r.net !== null);

    if (!rows.length) {
      emptyState(canvas, "No volume in this slice.");
      return { rows };
    }
    emptyState(canvas, null);

    const colour = c.scenario[ctx.primary];
    const series = [
      { key: "list", label: "List price", colour: tint(colour, 0.72) },
      { key: "gross", label: "Invoiced (gross)", colour: tint(colour, 0.42) },
      { key: "net", label: "Kept (net)", colour },
    ];

    const chart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: rows.map((r) => r.label),
        datasets: series.map((s) => ({
          label: s.label,
          data: rows.map((r) => r[s.key]),
          backgroundColor: s.colour,
          borderWidth: 0,
          borderRadius: 1,
          barPercentage: 0.82,
          categoryPercentage: 0.7,
        })),
      },
      options: {
        ...baseOptions(),
        layout: { padding: { top: 18 } },
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: { color: c.inkSoft, boxWidth: 10, boxHeight: 10, font: { size: 11 }, padding: 14 },
          },
          tooltip: tooltip(c, {
            callbacks: {
              label: (item) => `${item.dataset.label}  € ${perCase(item.parsed.y)} per case`,
              footer: (items) => {
                const r = rows[items[0].dataIndex];
                return `Cost € ${perCase(r.cost)} per case · gross-to-net ${((1 - r.net / r.gross) * 100).toFixed(1)}%`;
              },
            },
          }),
        },
        scales: {
          x: axisX(c, { ticks: { color: c.ink, font: { size: 12 } } }),
          y: axisY(c, { beginAtZero: true, ticks: { color: c.inkSoft, font: { size: 11 }, padding: 8, callback: (v) => `€${v}` } }),
        },
      },
      plugins: [barLabels(c, (i, d) => perCase(rows[i][series[d].key]))],
    });

    return { chart, rows };
  });
}
