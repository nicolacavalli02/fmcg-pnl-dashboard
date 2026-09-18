/**
 * Is it us or the market? Volume share by category, the scenario being read
 * against the comparison, drawn as a dumbbell so the movement is the shape.
 *
 * The market is an independent series in the dataset -- sized once off the
 * prior year and grown at its own rate -- which is the only reason this
 * chart means anything. Derived from our own volume, share would be a
 * constant and every dumbbell a single dot.
 *
 * Unavailable below category level: the market is not held per customer.
 */

import { metricsBy } from "../logic/index.js";
import { percent } from "../ui/format.js";
import { axisX, axisY, baseOptions, chartModule, emptyState, tooltip } from "./theme.js";

function connectors(c) {
  return {
    id: "dumbbell",
    beforeDatasetsDraw(chart) {
      if (chart.data.datasets.length < 2) return;
      const a = chart.getDatasetMeta(0).data;
      const b = chart.getDatasetMeta(1).data;
      const { ctx } = chart;
      ctx.save();
      ctx.strokeStyle = c.lineStrong;
      ctx.lineWidth = 2;
      a.forEach((from, i) => {
        const to = b[i];
        if (!to) return;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      });
      ctx.restore();
    },
  };
}

function endLabels(c) {
  return {
    id: "shareLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = "600 11px 'IBM Plex Sans', system-ui, sans-serif";
      ctx.textBaseline = "middle";
      chart.data.datasets.forEach((ds, d) => {
        const meta = chart.getDatasetMeta(d);
        const other = chart.data.datasets[1 - d];
        meta.data.forEach((el, i) => {
          const v = ds.data[i];
          const o = other?.data[i];
          const right = o === undefined || v >= o;
          ctx.fillStyle = ds.borderColor;
          ctx.textAlign = right ? "left" : "right";
          ctx.fillText(`${v.toFixed(2)}%`, el.x + (right ? 11 : -11), el.y);
        });
      });
      ctx.restore();
    },
  };
}

export function createMarketShare(dataset, canvas) {
  return chartModule(canvas, (ctx, c) => {
    if (ctx.scoped) {
      emptyState(canvas, "Market size is held per category, not per customer, so share cannot be stated below group level.");
      return { available: false };
    }
    const primary = metricsBy(dataset, ctx.filters, "category").filter(
      (e) => e.metrics.marketShareVolumePct !== null
    );
    if (!primary.length) {
      emptyState(canvas, "No categories in this slice.");
      return { available: false };
    }
    emptyState(canvas, null);

    const reference = ctx.compare
      ? new Map(metricsBy(dataset, ctx.referenceFilters, "category").map((e) => [e.key, e.metrics]))
      : null;

    const labels = primary.map((e) => e.label);
    const datasets = [
      {
        id: ctx.primary,
        label: dataset.scenario(ctx.primary).label,
        data: primary.map((e) => e.metrics.marketShareVolumePct * 100),
        borderColor: c.scenario[ctx.primary],
        backgroundColor: c.scenario[ctx.primary],
        pointRadius: 7,
        pointHoverRadius: 9,
        showLine: false,
      },
    ];
    if (reference) {
      datasets.push({
        id: ctx.compare,
        label: dataset.scenario(ctx.compare).label,
        data: primary.map((e) => (reference.get(e.key)?.marketShareVolumePct ?? 0) * 100),
        borderColor: c.scenario[ctx.compare],
        backgroundColor: c.surface,
        borderWidth: 2.5,
        pointRadius: 6,
        pointHoverRadius: 8,
        showLine: false,
      });
    }

    const all = datasets.flatMap((d) => d.data);
    const chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels, datasets },
      options: {
        ...baseOptions(),
        indexAxis: "y",
        layout: { padding: { right: 60, left: 4 } },
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: { color: c.inkSoft, usePointStyle: true, boxWidth: 8, font: { size: 11 }, padding: 14 },
          },
          tooltip: tooltip(c, {
            callbacks: {
              label: (item) => `${item.dataset.label}  ${percent(item.parsed.x / 100)} of the category`,
              footer: (items) => {
                if (!reference) return "";
                const i = items[0].dataIndex;
                const delta = datasets[0].data[i] - datasets[1].data[i];
                return `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}pp of share`;
              },
            },
          }),
        },
        scales: {
          x: axisY(c, {
            min: Math.max(0, Math.floor(Math.min(...all) - 1.5)),
            max: Math.ceil(Math.max(...all) + 1.5),
            ticks: { color: c.inkSoft, font: { size: 11 }, callback: (v) => `${v}%` },
          }),
          y: axisX(c, { ticks: { color: c.ink, font: { size: 12 } } }),
        },
      },
      plugins: [connectors(c), endLabels(c)],
    });

    return { chart, available: true, rows: primary.length };
  });
}
