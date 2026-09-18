/**
 * Waterfall rendering shared by every bridge on the page.
 *
 * Two kinds exist and the difference is principled, not cosmetic.
 *
 * A *structural* waterfall decomposes a level -- gross sales down to net
 * revenue -- and draws its totals as full bars from zero, because those bars
 * are levels and length is the honest encoding. Its steps are large relative
 * to the whole, so the zero baseline costs nothing.
 *
 * A *bridge* explains a movement between two scenarios and draws the steps
 * only. A full-height total at each end would force the axis to include
 * zero and squash three-million-euro steps on a sixty-million scale; cutting
 * the axis while keeping the totals would be worse, since a bar at 89% of
 * another would look half its size. So in a bridge no bar encodes a level:
 * every bar encodes a change and carries its value, and the two totals are
 * stated in the caption where they cannot be misread.
 */

import { money } from "../ui/format.js";
import { axisX, axisY, barLabels, baseOptions, MILLION, tooltip } from "./theme.js";

/**
 * @param {object[]} bars  [{ label, start, end, delta, isTotal, colour, note }]
 * @param {object}   opts  { mode: "bridge" | "structural", c, canvas, onClick }
 */
export function renderWaterfall(canvas, c, bars, { mode = "bridge", valueText, footer } = {}) {
  const levels = bars.flatMap((b) => [b.start, b.end]);
  const low = mode === "structural" ? 0 : Math.min(...levels);
  const high = Math.max(...levels);
  const span = Math.max(high - low, 0.4 * MILLION);
  const padTop = span * 0.18;
  const padBottom = mode === "structural" ? 0 : span * 0.22;

  const text =
    valueText ??
    ((i) => {
      const b = bars[i];
      return b.isTotal ? money(b.end).replace("m", "") : money(b.delta, { signed: true }).replace("m", "");
    });

  const chart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: bars.map((b) => b.label),
      datasets: [
        {
          data: bars.map((b) => [Math.min(b.start, b.end) / MILLION, Math.max(b.start, b.end) / MILLION]),
          backgroundColor: bars.map((b) => b.colour),
          borderWidth: 0,
          borderSkipped: false,
          borderRadius: 1,
          barPercentage: 0.66,
          categoryPercentage: 0.82,
        },
      ],
    },
    options: {
      ...baseOptions(),
      layout: { padding: { top: 20, bottom: 2 } },
      plugins: {
        legend: { display: false },
        tooltip: tooltip(c, {
          callbacks: {
            label: (item) => {
              const b = bars[item.dataIndex];
              if (b.isTotal) return `${money(b.end)}`;
              return `${money(b.delta, { signed: true })}${b.note ? `  ·  ${b.note}` : ""}`;
            },
            footer: footer ? (items) => footer(items[0].dataIndex) : undefined,
          },
        }),
      },
      scales: {
        x: axisX(c, { ticks: { color: c.inkSoft, font: { size: 11 }, maxRotation: 28, autoSkip: false } }),
        y: axisY(c, {
          min: (low - padBottom) / MILLION,
          max: (high + padTop) / MILLION,
          beginAtZero: mode === "structural",
          ticks: { color: c.inkSoft, font: { size: 11 }, padding: 8, callback: (v) => `${v}` },
        }),
      },
    },
    plugins: [barLabels(c, text)],
  });
  return chart;
}

/** Bars for a bridge from `start` through signed `steps` [{label, value, favourable}]. */
export function bridgeBars(c, start, steps) {
  let running = start;
  return steps.map((step) => {
    const from = running;
    const to = running + step.value;
    running = to;
    return {
      label: step.label,
      start: from,
      end: to,
      delta: step.value,
      isTotal: false,
      note: step.favourable === null ? "no movement" : step.favourable ? "helped" : "hurt",
      colour: step.favourable === null ? c.inkFaint : step.favourable ? c.favourable : c.adverse,
    };
  });
}
