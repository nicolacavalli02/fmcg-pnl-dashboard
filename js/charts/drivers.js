/**
 * Who is driving the gap: net revenue variance by dimension, ranked.
 *
 * This is the dimensional half of the drilldown. The bars are ordered by the
 * size of the gap rather than by dimension order, because the question is
 * which members moved the number, not which members exist. Clicking one
 * drills into it and the chart advances to the next level of the hierarchy.
 *
 * Horizontal bars diverging from zero, and here the zero baseline is not
 * negotiable: these bars encode magnitudes of a difference, so length is
 * exactly what the reader is comparing.
 */

import { varianceBy } from "../logic/index.js";
import { money } from "../ui/format.js";
import { axisX, axisY, barLabels, baseOptions, chartModule, emptyState, MILLION, tooltip } from "./theme.js";

export function createDrivers(dataset, canvas, state) {
  return chartModule(canvas, (ctx, c) => {
    const dimension = ctx.drillDimension;
    if (!ctx.compare) {
      emptyState(canvas, "Turn on a comparison to rank who is driving the gap.");
      return { dimension: null, rows: [], reason: "no-compare" };
    }
    if (!dimension) {
      emptyState(canvas, "Every level is already filtered. Step back up in the trail to break the gap down again.");
      return { dimension: null, rows: [], reason: "exhausted" };
    }
    emptyState(canvas, null);

    const rows = varianceBy(dataset, ctx.filters, {
      against: ctx.compare,
      rowId: "net_revenue",
      dimension,
    }).filter((row) => row.available);

    const chart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            data: rows.map((r) => r.delta / MILLION),
            backgroundColor: rows.map((r) => (r.favourable ? c.favourable : c.adverse)),
            borderWidth: 0,
            borderRadius: 1,
            barPercentage: 0.68,
            categoryPercentage: 0.8,
          },
        ],
      },
      options: {
        ...baseOptions(),
        indexAxis: "y",
        layout: { padding: { right: 56, left: 4 } },
        onClick: (_event, elements) => {
          if (!elements.length) return;
          const row = rows[elements[0].index];
          state.drillInto(dimension, row.key, row.label);
        },
        onHover: (event, elements) => {
          event.native.target.style.cursor = elements.length ? "pointer" : "default";
        },
        plugins: {
          legend: { display: false },
          tooltip: tooltip(c, {
            callbacks: {
              label: (item) => {
                const row = rows[item.dataIndex];
                const pct = row.deltaPct === null ? "" : `  ·  ${(row.deltaPct * 100).toFixed(1)}%`;
                return `${money(row.delta, { signed: true })}${pct}`;
              },
              footer: () => "Click to drill in",
            },
          }),
        },
        scales: {
          x: axisY(c, { beginAtZero: true, ticks: { color: c.inkSoft, font: { size: 11 }, callback: (v) => `${v}m` } }),
          y: axisX(c, { ticks: { color: c.ink, font: { size: 12 } } }),
        },
      },
      plugins: [barLabels(c, (i) => money(rows[i].delta, { signed: true }))],
    });

    return { chart, dimension, rows };
  });
}
