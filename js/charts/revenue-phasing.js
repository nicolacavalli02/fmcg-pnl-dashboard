/**
 * Net revenue phasing: the scenarios on screen, month by month.
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
import { SCENARIO_SHORT } from "../state.js";
import { axisX, axisY, baseOptions, chartModule, MILLION, tooltip } from "./theme.js";

const one = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/** Shade the months that are not yet closed and mark the boundary. */
function openPeriodPlugin(lastClosedMonth, c) {
  return {
    id: "openPeriod",
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea) return;
      const boundary = scales.x.getPixelForValue(lastClosedMonth - 1);
      ctx.save();
      ctx.fillStyle = c.openPeriod;
      ctx.fillRect(boundary, chartArea.top, chartArea.right - boundary, chartArea.bottom - chartArea.top);
      ctx.strokeStyle = c.lineStrong;
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

const STYLE = {
  ly_actual: { width: 1.5, dash: [], order: 4 },
  budget: { width: 2, dash: [], order: 3 },
  forecast: { width: 2.5, dash: [6, 4], order: 2 },
  cy_actual: { width: 3, dash: [], order: 1 },
};

export function createRevenuePhasing(dataset, canvas) {
  return chartModule(canvas, (ctx, c) => {
    const closed = dataset.lastClosedMonth;
    const labels = dataset.meta.months.map((m) => m.short);

    // Dimensional filters apply; the month filter deliberately does not.
    const { months, scenario, ...dimensional } = ctx.filters;
    const seriesFor = (id) =>
      monthlySeries(dataset, { ...dimensional, scenario: id }, "net_revenue").map(
        (point) => point.value / MILLION
      );

    // The reader asked for these; the actual and the forecast share a line
    // in practice, so if only one of the two is on screen the other's half
    // of the year is still drawn, dashed, so the year is never cut in half.
    const wanted = new Set(ctx.state.scenarios);
    const drawActual = wanted.has("cy_actual") || wanted.has("forecast");
    const drawForecast = wanted.has("forecast") || wanted.has("cy_actual");

    const full = {
      ly_actual: seriesFor("ly_actual"),
      budget: seriesFor("budget"),
      cy_actual: seriesFor("cy_actual"),
      forecast: seriesFor("forecast"),
    };
    const shownSeries = {
      ly_actual: wanted.has("ly_actual") ? full.ly_actual : null,
      budget: wanted.has("budget") ? full.budget : null,
      cy_actual: drawActual ? full.cy_actual.map((v, i) => (i + 1 <= closed ? v : null)) : null,
      forecast: drawForecast ? full.forecast.map((v, i) => (i + 1 >= closed ? v : null)) : null,
    };

    const observed = Object.values(shownSeries).flat().filter((v) => v !== null);
    const lowest = Math.min(...observed);
    const highest = Math.max(...observed);
    const axisFloor = Math.max(0, Math.floor(lowest - (highest - lowest) * 0.35));

    // Whatever the comparison control says is the line every tooltip
    // measures against, so the chart and the masthead never disagree.
    const reference = ctx.compare ? full[ctx.compare] : null;

    const datasets = Object.entries(shownSeries)
      .filter(([, data]) => data)
      .map(([id, data]) => ({
        id,
        label: dataset.scenario(id).label,
        data,
        borderColor: c.scenario[id],
        backgroundColor: c.scenario[id],
        borderWidth: STYLE[id].width,
        borderDash: STYLE[id].dash,
        order: STYLE[id].order,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 14,
        spanGaps: false,
      }));

    const chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels, datasets },
      options: {
        ...baseOptions(),
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 8, right: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: tooltip(c, {
            displayColors: true,
            usePointStyle: true,
            callbacks: {
              title: (items) =>
                `${dataset.meta.months[items[0].dataIndex].label} · ${
                  items[0].dataIndex + 1 <= closed ? "closed" : "open"
                }`,
              label: (item) => {
                const value = `${one.format(item.parsed.y)}m`;
                const against = reference?.[item.dataIndex];
                if (!against || item.dataset.id === ctx.compare) {
                  return `  ${item.dataset.label}   ${value}`;
                }
                const gap = (item.parsed.y / against - 1) * 100;
                return `  ${item.dataset.label}   ${value}   ${signed.format(gap)}% vs ${
                  SCENARIO_SHORT[ctx.compare]
                }`;
              },
            },
          }),
        },
        scales: {
          x: axisX(c),
          // The axis is cut, not zero based. On a bar chart that would be
          // indefensible, because length encodes the value. On a time series
          // line the reader is following movement, and the scenarios sit
          // within three per cent of each other: a zero baseline would squeeze
          // them into an unreadable band. The floor is derived from the data,
          // never picked to flatter it.
          y: axisY(c, { beginAtZero: false, min: axisFloor, ticks: { color: c.inkSoft, font: { size: 11.5 }, padding: 8, callback: (v) => `${v}m` } }),
        },
      },
      plugins: [openPeriodPlugin(closed, c)],
    });

    return { chart, series: full, shown: Object.keys(shownSeries).filter((k) => shownSeries[k]) };
  });
}
