/**
 * Why the result moved: a waterfall from the reference scenario to the
 * current one, through the P&L blocks.
 *
 * The chart draws the *steps only*, not the opening and closing totals.
 *
 * That is a deliberate refusal. A conventional waterfall puts a full-height
 * bar at each end, which forces the axis to include zero, which squashes
 * three-million-euro steps into invisibility on a sixty-million-euro scale.
 * The usual fix is to truncate the axis anyway and let the total bars sit on
 * the floor -- but then a bar at 89% of another looks half its size, and the
 * one thing a bar chart must never do is lie about length.
 *
 * So no bar here encodes a level. Every bar encodes a change, the axis is
 * free to frame the movement, and the two totals are stated as text where
 * they cannot be misread. The steps come from pnlBridge, which guarantees
 * they sum exactly to the difference between them.
 *
 * The target adapts: EBITDA at group level, contribution margin once a
 * customer filter puts the overhead out of reach.
 */

import { pnlBridge } from "../logic/index.js";
import { cssVar, money } from "../ui/format.js";

const MILLION = 1e6;

function palette() {
  return {
    favourable: cssVar("--variance-favourable"),
    adverse: cssVar("--variance-adverse"),
    neutral: cssVar("--ink-faint"),
    ink: cssVar("--ink"),
    inkSoft: cssVar("--ink-soft"),
    line: cssVar("--line"),
    surface: cssVar("--surface"),
  };
}

/** Print each bar's movement on the bar, so length never has to carry it. */
function valueLabels(colours) {
  return {
    id: "valueLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.font = "600 11px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      for (const [i, element] of meta.data.entries()) {
        const raw = chart.data.datasets[0].data[i];
        const delta = chart.data.datasets[0].deltas[i];
        if (delta === null || delta === undefined) continue;
        const rising = raw[1] > raw[0];
        const top = Math.min(element.y, element.base);
        const bottom = Math.max(element.y, element.base);
        ctx.fillStyle = colours.ink;
        ctx.textBaseline = rising ? "bottom" : "top";
        ctx.fillText(
          money(delta, { signed: true }).replace("m", ""),
          element.x,
          rising ? top - 5 : bottom + 5
        );
      }
      ctx.restore();
    },
  };
}

export function createVarianceBridge(dataset, canvas) {
  let chart = null;

  function build(ctx) {
    const colours = palette();
    const bridge = pnlBridge(dataset, {
      from: ctx.basis.against,
      to: ctx.basis.scenario,
      filters: ctx.filters,
      target: ctx.bridgeTarget,
    });

    if (!bridge.available) return { bridge, bars: [] };

    let running = bridge.start;
    const bars = bridge.steps.map((step) => {
      const from = running;
      const to = running + step.value;
      running = to;
      return {
        label: step.label,
        range: [Math.min(from, to), Math.max(from, to)],
        delta: step.value,
        favourable: step.favourable,
      };
    });

    const levels = bars.flatMap((b) => b.range).concat(bridge.start, bridge.end);
    const low = Math.min(...levels);
    const high = Math.max(...levels);
    const pad = Math.max((high - low) * 0.28, 0.4 * MILLION);

    chart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: bars.map((b) => b.label),
        datasets: [
          {
            data: bars.map((b) => b.range.map((v) => v / MILLION)),
            deltas: bars.map((b) => b.delta / MILLION),
            backgroundColor: bars.map((b) =>
              b.favourable === null
                ? colours.neutral
                : b.favourable
                  ? colours.favourable
                  : colours.adverse
            ),
            borderWidth: 0,
            borderSkipped: false,
            borderRadius: 2,
            barPercentage: 0.62,
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
        layout: { padding: { top: 22, bottom: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: colours.surface,
            titleColor: colours.ink,
            bodyColor: colours.ink,
            borderColor: colours.line,
            borderWidth: 1,
            padding: 11,
            displayColors: false,
            callbacks: {
              label: (item) => {
                const bar = bars[item.dataIndex];
                const direction =
                  bar.favourable === null
                    ? "no movement"
                    : bar.favourable
                      ? "helped"
                      : "hurt";
                return `${money(bar.delta, { signed: true })}  ·  ${direction}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: colours.line },
            ticks: {
              color: colours.inkSoft,
              font: { size: 11 },
              maxRotation: 30,
              minRotation: 0,
              autoSkip: false,
            },
          },
          y: {
            min: (low - pad) / MILLION,
            max: (high + pad) / MILLION,
            grid: { color: colours.line, drawTicks: false },
            border: { display: false },
            ticks: {
              color: colours.inkSoft,
              font: { size: 11 },
              padding: 8,
              callback: (v) => `${v}m`,
            },
          },
        },
      },
      plugins: [valueLabels(colours)],
    });

    return { bridge, bars };
  }

  return {
    render(ctx) {
      if (chart) {
        chart.destroy();
        chart = null;
      }
      return build(ctx);
    },
    destroy() {
      if (chart) chart.destroy();
      chart = null;
    },
  };
}
