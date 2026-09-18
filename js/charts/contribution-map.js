/**
 * Who contributes: every customer placed by size and by what it keeps.
 *
 * Net revenue across, contribution margin up, one colour per channel. The
 * dashed line is the group's own margin, so a customer below it is diluting
 * the average however large it is -- which is where the Discount channel
 * stops looking like growth. Click a customer to drill into it.
 *
 * Contribution margin is the deepest line a customer can honestly be read
 * at; EBITDA is not plotted here because it does not exist at this grain.
 */

import { metricsBy, metricsFrom } from "../logic/index.js";
import { money, percent } from "../ui/format.js";
import { axisX, axisY, baseOptions, channelColour, chartModule, emptyState, MILLION, referenceLine, tooltip } from "./theme.js";

function pointLabels(c, points) {
  return {
    id: "scatterLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = "500 10.5px 'IBM Plex Sans', system-ui, sans-serif";
      ctx.fillStyle = c.inkSoft;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      chart.data.datasets.forEach((ds, d) => {
        const meta = chart.getDatasetMeta(d);
        meta.data.forEach((el, i) => {
          ctx.fillText(ds.data[i].label, el.x + 9, el.y);
        });
      });
      ctx.restore();
    },
  };
}

export function createContributionMap(dataset, canvas, state) {
  return chartModule(canvas, (ctx, c) => {
    const members = metricsBy(dataset, ctx.filters, "customer").filter(
      (e) => e.metrics.netRevenue > 0 && e.metrics.contributionMarginPct !== null
    );
    if (!members.length) {
      emptyState(canvas, "No customers in this slice.");
      return { points: [] };
    }
    emptyState(canvas, null);

    const groupMargin = metricsFrom(dataset, ctx.ladder).contributionMarginPct;

    const byChannel = new Map();
    for (const e of members) {
      const channel = dataset.customer(e.key).channel;
      if (!byChannel.has(channel)) byChannel.set(channel, []);
      byChannel.get(channel).push({
        key: e.key,
        label: e.label,
        x: e.metrics.netRevenue / MILLION,
        y: e.metrics.contributionMarginPct * 100,
        g2n: e.metrics.grossToNetPct,
        cm: e.metrics.contributionMargin,
      });
    }

    const datasets = [...byChannel.entries()].map(([channel, data]) => ({
      label: dataset.channel(channel).label,
      data,
      backgroundColor: channelColour(c, dataset, channel),
      borderColor: c.surface,
      borderWidth: 1.5,
      pointRadius: 7,
      pointHoverRadius: 9,
    }));

    const chart = new Chart(canvas.getContext("2d"), {
      type: "scatter",
      data: { datasets },
      options: {
        ...baseOptions(),
        layout: { padding: { right: 96, top: 8 } },
        onClick: (_event, elements) => {
          if (!elements.length) return;
          const { datasetIndex, index } = elements[0];
          const p = datasets[datasetIndex].data[index];
          // Deferred past Chart.js's own event handling; see drivers.js.
          queueMicrotask(() => state.drillInto("customer", p.key, p.label));
        },
        onHover: (event, elements) => {
          event.native.target.style.cursor = elements.length ? "pointer" : "default";
        },
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: { color: c.inkSoft, usePointStyle: true, boxWidth: 8, font: { size: 11 }, padding: 14 },
          },
          tooltip: tooltip(c, {
            callbacks: {
              title: (items) => items[0].raw.label,
              label: (item) => [
                `Net revenue ${money(item.raw.x * MILLION)}`,
                `Contribution ${money(item.raw.cm)} · ${percent(item.raw.y / 100)}`,
                `Gross-to-net ${percent(item.raw.g2n)}`,
              ],
              footer: () => "Click to drill in",
            },
          }),
        },
        scales: {
          x: axisX(c, {
            title: { display: true, text: "Net revenue", color: c.inkSoft, font: { size: 11 } },
            beginAtZero: true,
            ticks: { color: c.inkSoft, font: { size: 11 }, callback: (v) => `${v}m` },
          }),
          y: axisY(c, {
            title: { display: true, text: "Contribution margin", color: c.inkSoft, font: { size: 11 } },
            ticks: { color: c.inkSoft, font: { size: 11 }, padding: 8, callback: (v) => `${v}%` },
          }),
        },
      },
      plugins: [
        referenceLine(c, groupMargin * 100, `group ${percent(groupMargin)}`),
        pointLabels(c),
      ],
    });

    return { chart, points: members.length, groupMargin };
  });
}
