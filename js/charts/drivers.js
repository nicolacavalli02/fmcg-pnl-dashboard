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
import { cssVar, money } from "../ui/format.js";

const MILLION = 1e6;

const DIMENSION_LABEL = {
  channel: "channel",
  customer: "customer",
  category: "category",
};

export function createDrivers(dataset, canvas, state) {
  let chart = null;

  return {
    render(ctx) {
      if (chart) {
        chart.destroy();
        chart = null;
      }
      const dimension = ctx.drillDimension;
      if (!dimension) return { dimension: null, rows: [] };

      const rows = varianceBy(dataset, ctx.filters, {
        against: ctx.basis.against,
        rowId: "net_revenue",
        dimension,
      }).filter((row) => row.available);

      const favourable = cssVar("--variance-favourable");
      const adverse = cssVar("--variance-adverse");
      const inkSoft = cssVar("--ink-soft");
      const line = cssVar("--line");
      const surface = cssVar("--surface");
      const ink = cssVar("--ink");

      chart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: {
          labels: rows.map((r) => r.label),
          datasets: [
            {
              data: rows.map((r) => r.delta / MILLION),
              backgroundColor: rows.map((r) =>
                r.favourable ? favourable : adverse
              ),
              borderWidth: 0,
              borderRadius: 2,
              barPercentage: 0.7,
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          // Charts are rebuilt on every state change, so the default one
          // second entrance would replay in full on every slicer click. Short
          // enough to acknowledge the change, not long enough to be noise.
          animation: { duration: 260 },
          onClick: (_event, elements) => {
            if (!elements.length) return;
            const row = rows[elements[0].index];
            state.drillInto(dimension, row.key, row.label);
          },
          onHover: (event, elements) => {
            // Chart.js replays the last hover after an update, and that
            // synthetic event carries no native one to read a target from.
            const target = event.native?.target;
            if (!target) return;
            target.style.cursor = elements.length ? "pointer" : "default";
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: surface,
              titleColor: ink,
              bodyColor: ink,
              borderColor: line,
              borderWidth: 1,
              padding: 11,
              displayColors: false,
              callbacks: {
                label: (item) => {
                  const row = rows[item.dataIndex];
                  const pct =
                    row.deltaPct === null
                      ? ""
                      : `  ·  ${(row.deltaPct * 100).toFixed(1)}%`;
                  return `${money(row.delta, { signed: true })}${pct}  ·  click to drill in`;
                },
              },
            },
          },
          scales: {
            x: {
              // Zero baseline, non negotiable: these bars are magnitudes of a
              // difference and length is the whole comparison.
              beginAtZero: true,
              grid: { color: line, drawTicks: false },
              border: { display: false },
              ticks: {
                color: inkSoft,
                font: { size: 11 },
                callback: (v) => `${v}m`,
              },
            },
            y: {
              grid: { display: false },
              border: { color: line },
              ticks: { color: inkSoft, font: { size: 12 } },
            },
          },
        },
      });

      return { dimension, dimensionLabel: DIMENSION_LABEL[dimension], rows };
    },
    destroy() {
      if (chart) chart.destroy();
      chart = null;
    },
  };
}
