/**
 * What every chart shares: the palette read from CSS, the tooltip and axis
 * styling, and the value-label plugin.
 *
 * Colour is defined once, in css/style.css, and read here at render time, so
 * a chart module never carries a hex value and light and dark stay in step.
 * Before this file existed each chart re-read the palette and re-declared
 * the same tooltip block; the review found four copies drifting apart.
 */

import { cssVar, tint } from "../ui/format.js";

export { tint };
export const MILLION = 1e6;

export function colours() {
  return {
    scenario: {
      cy_actual: cssVar("--scenario-actual"),
      forecast: cssVar("--scenario-forecast"),
      budget: cssVar("--scenario-budget"),
      ly_actual: cssVar("--scenario-ly"),
    },
    dimension: [cssVar("--dim-a"), cssVar("--dim-b"), cssVar("--dim-c"), cssVar("--dim-d"), cssVar("--dim-e")],
    favourable: cssVar("--variance-favourable"),
    adverse: cssVar("--variance-adverse"),
    ink: cssVar("--ink"),
    inkSoft: cssVar("--ink-soft"),
    inkFaint: cssVar("--ink-faint"),
    line: cssVar("--line"),
    lineStrong: cssVar("--line-strong"),
    surface: cssVar("--surface"),
    openPeriod: cssVar("--open-period"),
  };
}

/** One colour per channel, stable across charts. */
export function channelColour(c, dataset, channelId) {
  const i = dataset.meta.channels.findIndex((ch) => ch.id === channelId);
  return c.dimension[Math.max(0, i) % c.dimension.length];
}

export function tooltip(c, overrides = {}) {
  return {
    backgroundColor: c.surface,
    titleColor: c.ink,
    bodyColor: c.ink,
    footerColor: c.inkSoft,
    borderColor: c.lineStrong,
    borderWidth: 1,
    padding: 11,
    boxPadding: 5,
    cornerRadius: 3,
    displayColors: false,
    titleFont: { weight: "600" },
    footerFont: { weight: "400", size: 11 },
    ...overrides,
  };
}

export function axisX(c, overrides = {}) {
  return {
    grid: { display: false },
    border: { color: c.line },
    ticks: { color: c.inkSoft, font: { size: 11.5 } },
    ...overrides,
  };
}

export function axisY(c, overrides = {}) {
  return {
    grid: { color: c.line, drawTicks: false },
    border: { display: false },
    ticks: { color: c.inkSoft, font: { size: 11.5 }, padding: 8 },
    ...overrides,
  };
}

/**
 * Print a text label on each bar. `text(index)` returns the string or null.
 * Written inline rather than pulling in the datalabels plugin: a few
 * fillText calls do not justify another dependency.
 */
export function barLabels(c, text, { inside = false } = {}) {
  return {
    id: "barLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = "600 11px 'IBM Plex Sans', system-ui, sans-serif";
      ctx.fillStyle = c.ink;
      chart.data.datasets.forEach((dataset, d) => {
        const meta = chart.getDatasetMeta(d);
        if (meta.hidden) return;
        meta.data.forEach((element, i) => {
          const label = text(i, d);
          if (label === null || label === undefined) return;
          const horizontal = chart.options.indexAxis === "y";
          if (horizontal) {
            const rising = element.x >= element.base;
            ctx.textBaseline = "middle";
            ctx.textAlign = rising ? "left" : "right";
            ctx.fillText(label, element.x + (rising ? 6 : -6), element.y);
          } else {
            const rising = element.y <= element.base;
            ctx.textAlign = "center";
            if (inside) {
              ctx.textBaseline = "top";
              ctx.fillStyle = "#fff";
              ctx.fillText(label, element.x, Math.min(element.y, element.base) + 6);
            } else {
              ctx.textBaseline = rising ? "bottom" : "top";
              ctx.fillText(
                label,
                element.x,
                rising ? Math.min(element.y, element.base) - 5 : Math.max(element.y, element.base) + 5
              );
            }
          }
        });
      });
      ctx.restore();
    },
  };
}

/** A horizontal reference line at `value` on the y axis. */
export function referenceLine(c, value, label) {
  return {
    id: `reference-${label}`,
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || value < scales.y.min || value > scales.y.max) return;
      const y = scales.y.getPixelForValue(value);
      ctx.save();
      ctx.strokeStyle = c.inkFaint;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = c.inkFaint;
      ctx.font = "500 10.5px 'IBM Plex Sans', system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(label, chartArea.right - 4, y - 3);
      ctx.restore();
    },
  };
}

/** Shared option block. Charts spread this and override what they need. */
export function baseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    // Charts are rebuilt on every state change, so the default one second
    // entrance would replay in full on every slicer click. Short enough to
    // acknowledge the change, not long enough to be noise.
    animation: { duration: prefersReducedMotion() ? 0 : 240 },
  };
}

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A chart module's lifecycle: build on render, destroy before rebuilding.
 * `build(ctx, c)` returns { chart, ...anything the caller wants back }.
 */
export function chartModule(canvas, build) {
  let chart = null;
  return {
    render(ctx) {
      if (chart) chart.destroy();
      chart = null;
      const result = build(ctx, colours(), canvas) ?? {};
      chart = result.chart ?? null;
      return result;
    },
    destroy() {
      if (chart) chart.destroy();
      chart = null;
    },
  };
}

/** Empty-state message drawn into a canvas's frame instead of a chart. */
export function emptyState(canvas, message) {
  const frame = canvas.parentElement;
  let note = frame.querySelector(".chart-empty");
  if (!message) {
    note?.remove();
    canvas.hidden = false;
    return;
  }
  if (!note) {
    note = document.createElement("p");
    note.className = "chart-empty";
    frame.append(note);
  }
  note.textContent = message;
  canvas.hidden = true;
}
