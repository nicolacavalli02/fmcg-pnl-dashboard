/**
 * Page controller.
 *
 * Loads the dataset once, owns the state, and orchestrates a render. Nothing
 * here computes a figure -- that is /js/logic -- and nothing here draws a
 * chart -- that is /js/charts and /js/ui. This file only decides what runs
 * when, and hands every component the same context object so no two parts of
 * the page can end up reading different filters.
 */

import { ladder, loadDataset } from "./logic/index.js";
import {
  createState,
  hydrateDrillLabels,
  renderContext,
} from "./state.js";
import { createSlicers } from "./ui/slicers.js";
import { createBreadcrumb } from "./ui/breadcrumb.js";
import { createKpiStrip } from "./ui/kpi-strip.js";
import { createPnlTable } from "./ui/pnl-table.js";
import { createRevenuePhasing } from "./charts/revenue-phasing.js";
import { createVarianceBridge } from "./charts/variance-bridge.js";
import { createDrivers } from "./charts/drivers.js";
import { money, periodLabel } from "./ui/format.js";

const VIEWS = [
  { id: "performance", label: "Performance", ready: true },
  { id: "commercial", label: "Commercial", ready: false },
  { id: "portfolio", label: "Portfolio", ready: false },
];

const el = (id) => document.getElementById(id);

async function start() {
  const status = el("status");
  let dataset;
  try {
    dataset = await loadDataset();
  } catch (error) {
    status.innerHTML =
      "Could not load the dataset. The page reads it with <code>fetch</code>, " +
      "so it has to be served over HTTP: run " +
      "<code>python3 -m http.server</code> in the project root and open the " +
      "address it prints.";
    console.error(error);
    return;
  }

  const components = {
    slicers: null,
    breadcrumb: null,
    kpis: null,
    table: null,
    phasing: null,
    bridge: null,
    drivers: null,
  };

  const state = createState(() => render());

  components.slicers = createSlicers(dataset, el("slicers"), state);
  components.breadcrumb = createBreadcrumb(dataset, el("breadcrumb"), state);
  components.kpis = createKpiStrip(dataset, el("kpis"));
  components.table = createPnlTable(dataset, el("pnl-table"), state);
  components.phasing = createRevenuePhasing(dataset, el("chart-phasing"));
  components.bridge = createVarianceBridge(dataset, el("chart-bridge"));
  components.drivers = createDrivers(dataset, el("chart-drivers"), state);

  buildViewSwitcher(state);

  function render() {
    const started = performance.now();
    const current = state.get();

    // A hash can carry a drill key but not its label; resolve them once the
    // dataset is available so the breadcrumb reads properly on a shared link.
    const drill = hydrateDrillLabels(dataset, current);
    if (drill.some((d, i) => d.label !== current.drill[i].label)) {
      current.drill = drill;
    }

    const ctx = renderContext(dataset, current);
    ctx.ladder = ladder(dataset, ctx.filters);
    ctx.referenceLadder = ladder(dataset, ctx.referenceFilters);
    ctx.netRevenue = ctx.ladder.value("net_revenue");

    components.slicers.render(ctx);
    components.breadcrumb.render(ctx);
    syncViewSwitcher(current.view);

    for (const view of VIEWS) {
      el(`view-${view.id}`).hidden = view.id !== current.view;
    }

    if (current.view === "performance") {
      components.kpis.render(ctx);
      components.phasing.render(ctx);

      const bridge = components.bridge.render(ctx);
      captionBridge(dataset, ctx, bridge);

      const drivers = components.drivers.render(ctx);
      captionDrivers(ctx, drivers);

      components.table.render(ctx);
    }

    el("period-label").textContent = periodLabel(dataset, ctx.months);
    const elapsed = performance.now() - started;
    // Measured: about 80ms on the first render, settling to 16-40ms once the
    // scan memo in aggregate.js is warm. This threshold sits above that, so
    // it stays quiet in normal use and speaks up if something regresses.
    if (elapsed > 120) {
      console.warn(`Render took ${elapsed.toFixed(0)}ms`);
    }
  }

  function buildViewSwitcher() {
    const root = el("views");
    root.replaceChildren(
      ...VIEWS.map((view) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "view-tab";
        button.dataset.view = view.id;
        button.textContent = view.label;
        if (!view.ready) {
          const badge = document.createElement("span");
          badge.className = "view-badge";
          badge.textContent = "next";
          button.append(badge);
        }
        button.addEventListener("click", () => state.set({ view: view.id }));
        return button;
      })
    );
  }

  function syncViewSwitcher(active) {
    for (const button of el("views").querySelectorAll(".view-tab")) {
      button.setAttribute("aria-pressed", String(button.dataset.view === active));
    }
  }

  window.addEventListener("hashchange", () => state.adoptHash());

  // The palette lives in CSS and follows the system theme, so the charts have
  // to be rebuilt to pick up the new values.
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => render());

  status.remove();
  render();
}

function captionBridge(dataset, ctx, result) {
  const caption = el("caption-bridge");
  const title = el("title-bridge");
  const targetLabel = dataset.structureRow(ctx.bridgeTarget).label;
  title.textContent = `Why ${targetLabel} moved`;

  if (!result.bridge.available) {
    caption.textContent =
      "Not available at this grain: the overhead the bridge would walk " +
      "through is not held per customer.";
    return;
  }

  const { bridge } = result;
  const from = dataset.scenario(ctx.basis.against).label;
  const to = dataset.scenario(ctx.basis.scenario).label;
  const scoped = ctx.scoped
    ? " The target follows the filter: below group level the bridge stops at contribution margin, because the overhead is not there to walk through."
    : "";
  caption.textContent =
    `${from} ${money(bridge.start)} to ${to} ${money(bridge.end)}, ` +
    `a move of ${money(bridge.delta, { signed: true })}. Each bar is a ` +
    `change, not a level, and they sum to the difference exactly.${scoped}`;

  // The decomposition either ties or the chart is lying; say so out loud.
  if (Math.abs(bridge.residual) > 1) {
    console.error("Bridge does not tie, residual", bridge.residual);
  }
}

function captionDrivers(ctx, result) {
  const caption = el("caption-drivers");
  const title = el("title-drivers");

  if (!result.dimension) {
    title.textContent = "Who is driving the gap";
    caption.textContent =
      "Every level of the hierarchy is already filtered. Step back up a " +
      "level in the trail above to break the gap down again.";
    return;
  }
  title.textContent = `Which ${result.dimensionLabel} is driving the gap`;
  caption.textContent =
    `Net revenue variance by ${result.dimensionLabel}, largest gap first. ` +
    "Click a bar to drill into it: every chart on the page refilters and the " +
    "breakdown advances to the next level.";
}

start();
