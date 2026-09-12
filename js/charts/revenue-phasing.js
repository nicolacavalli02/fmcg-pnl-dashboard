/**
 * Net revenue phasing: the four scenarios month by month.
 *
 * Three conventions are enforced here rather than left to the data.
 *
 * The actual line stops at the last closed month. The generator does produce
 * current year figures for the open months, but a dashboard that drew them
 * would be showing numbers the business does not have yet. Beyond the close,
 * only the Latest Estimate has anything to say.
 *
 * The forecast is drawn from the last closed month onward, so it continues
 * the actual line from the point the two agree, and it is always dashed. A
 * projection has to read as provisional even when the page is printed in
 * greyscale, so the distinction never rests on colour alone.
 *
 * The month slicer does not apply. Every dimensional filter does, but a
 * phasing chart cut to eight months is no longer a phasing chart, so the
 * shape of the year always shows in full and the card says so.
 */

import { monthlySeries } from "../logic/index.js";
import { cssVar } from "../ui/format.js";

const MILLION = 1e6;

function palette() {
  return {
    actual: cssVar("--scenario-actual"),
    forecast: cssVar("--scenario-forecast"),
    budget: cssVar("--scenario-budget"),
    ly: cssVar("--scenario-ly"),
    ink: cssVar("--ink"),
    inkSoft: cssVar("--ink-soft"),
    line: cssVar("--line"),
    surface: cssVar("--surface"),
    openPeriod: cssVar("--open-period"),
  };
}

const money = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const signed = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/**
 * Shade the months that are not yet closed and mark the boundary.
 * Written inline rather than pulling in the annotation plugin: one vertical
 * rule and one filled rectangle do not justify another dependency.
 */
function openPeriodPlugin(lastClosedMonth, colours) {
  return {
    id: "openPeriod",
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea) return;
      const boundary = scales.x.getPixelForValue(lastClosedMonth - 1);
      ctx.save();
      ctx.fillStyle = colours.openPeriod;
      ctx.fillRect(
        boundary,
        chartArea.top,
        chartArea.right - boundary,
        chartArea.bottom - chartArea.top
      );
      ctx.strokeStyle = colours.line;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(boundary, chartArea.top);
      ctx.lineTo(boundary, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    },
  };
}

export function createRevenuePhasing(dataset, canvas) {
  let chart = null;

  return {
    render(ctx) {
      if (chart) {
        chart.destroy();
        chart = null;
      }
      const colours = palette();
      const closed = dataset.lastClosedMonth;
      const labels = dataset.meta.months.map((m) => m.short);

      // Dimensional filters apply; the month filter deliberately does not.
      const { months, scenario, ...dimensional } = ctx.filters;
      const seriesFor = (id) =>
        monthlySeries(dataset, { ...dimensional, scenario: id }, "net_revenue")
          .map((point) => point.value / MILLION);

      const ly = seriesFor("ly_actual");
      const budget = seriesFor("budget");
      const actualFull = seriesFor("cy_actual");
      const forecastFull = seriesFor("forecast");

      const actual = actualFull.map((v, i) => (i + 1 <= closed ? v : null));
      const forecast = forecastFull.map((v, i) => (i + 1 >= closed ? v : null));

      // Floor the axis below the lowest point by a third of the observed
      // range, derived from the data so the framing never has to be re-tuned.
      const observed = [...ly, ...budget, ...actualFull, ...forecastFull];
      const lowest = Math.min(...observed);
      const highest = Math.max(...observed);
      const axisFloor = Math.max(
        0,
        Math.floor(lowest - (highest - lowest) * 0.35)
      );

      // Whatever the comparison slicer is set to is the line every tooltip
      // measures against, so the chart and the header never disagree.
      const referenceId = ctx.basis.against;
      const reference = { budget, ly_actual: ly }[referenceId] ?? budget;
      const referenceLabel = dataset.scenario(referenceId).label;

      const base = {
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 14,
        spanGaps: false,
      };

      chart = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              ...base,
              label: dataset.scenario("ly_actual").label,
              data: ly,
              borderColor: colours.ly,
              backgroundColor: colours.ly,
              borderWidth: 1.5,
              order: 4,
            },
            {
              ...base,
              label: dataset.scenario("budget").label,
              data: budget,
              borderColor: colours.budget,
              backgroundColor: colours.budget,
              borderWidth: 2,
              order: 3,
            },
            {
              ...base,
              label: dataset.scenario("forecast").label,
              data: forecast,
              borderColor: colours.forecast,
              backgroundColor: colours.forecast,
              borderWidth: 2.5,
              borderDash: [6, 4],
              order: 2,
            },
            {
              ...base,
              label: dataset.scenario("cy_actual").label,
              data: actual,
              borderColor: colours.actual,
              backgroundColor: colours.actual,
              borderWidth: 3,
              order: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          // Charts are rebuilt on every state change, so the default one
          // second entrance would replay in full on every slicer click. Short
          // enough to acknowledge the change, not long enough to be noise.
          animation: { duration: 260 },
          interaction: { mode: "index", intersect: false },
          layout: { padding: { top: 8, right: 4 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: colours.surface,
              titleColor: colours.ink,
              bodyColor: colours.ink,
              borderColor: colours.line,
              borderWidth: 1,
              padding: 12,
              boxPadding: 5,
              usePointStyle: true,
              callbacks: {
                title: (items) =>
                  `${dataset.meta.months[items[0].dataIndex].label} ${
                    items[0].dataIndex + 1 <= closed ? "· closed" : "· open"
                  }`,
                label: (item) => {
                  const value = `${money.format(item.parsed.y)}m`;
                  const against = reference[item.dataIndex];
                  if (item.dataset.label === referenceLabel || !against) {
                    return `  ${item.dataset.label}   ${value}`;
                  }
                  const gap = (item.parsed.y / against - 1) * 100;
                  return `  ${item.dataset.label}   ${value}   ${signed.format(
                    gap
                  )}% vs ${referenceId === "budget" ? "plan" : "LY"}`;
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              border: { color: colours.line },
              ticks: { color: colours.inkSoft, font: { size: 12 } },
            },
            y: {
              // The axis is cut, not zero based. On a bar chart that would be
              // indefensible, because length encodes the value. On a time
              // series line the reader is following movement, and the four
              // scenarios sit within three per cent of each other: a zero
              // baseline would squeeze them into an unreadable band and leave
              // three quarters of the panel empty. The floor is labelled and
              // derived from the data rather than picked to flatter it.
              beginAtZero: false,
              min: axisFloor,
              grid: { color: colours.line, drawTicks: false },
              border: { display: false },
              ticks: {
                color: colours.inkSoft,
                font: { size: 12 },
                padding: 8,
                callback: (value) => `${value}m`,
              },
            },
          },
        },
        plugins: [openPeriodPlugin(closed, colours)],
      });

      return { series: { ly, budget, actual, forecast } };
    },
    destroy() {
      if (chart) chart.destroy();
      chart = null;
    },
  };
}
