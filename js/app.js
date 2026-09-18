/**
 * Page controller.
 *
 * Loads the dataset once, owns the state, and orchestrates a render. Nothing
 * here computes a figure -- that is /js/logic -- and nothing here draws a
 * chart -- that is /js/charts and /js/ui. This file decides what runs when,
 * hands every component the same context object so no two parts of the page
 * can read different filters, and writes the captions that turn a chart's
 * result into a sentence.
 */

import { ladder, loadDataset } from "./logic/index.js";
import { createState, renderContext, SCENARIO_SHORT } from "./state.js";
import { createSlicers } from "./ui/slicers.js";
import { createMasthead } from "./ui/masthead.js";
import { createBreadcrumb } from "./ui/breadcrumb.js";
import { createKpiStrip } from "./ui/kpi-strip.js";
import { createPnlStatement } from "./ui/pnl-statement.js";
import { createRevenuePhasing } from "./charts/revenue-phasing.js";
import { createVarianceBridge } from "./charts/variance-bridge.js";
import { createDrivers } from "./charts/drivers.js";
import { createGrossToNet } from "./charts/gross-to-net.js";
import { createPvmBridge } from "./charts/pvm-bridge.js";
import { createRealisation } from "./charts/realisation.js";
import { createPromoReturn } from "./charts/promo-return.js";
import { createContributionMap } from "./charts/contribution-map.js";
import { createMarketShare } from "./charts/market-share.js";
import { money, percent, times } from "./ui/format.js";

const VIEWS = [
  { id: "performance", label: "Performance" },
  { id: "pnl", label: "P&L" },
  { id: "commercial", label: "Commercial" },
  { id: "portfolio", label: "Portfolio" },
];

const el = (id) => document.getElementById(id);
const setText = (id, text) => {
  el(id).textContent = text;
};

async function start() {
  const status = el("status");
  let dataset;
  try {
    dataset = await loadDataset();
  } catch (error) {
    status.innerHTML =
      "Could not load the dataset. The page reads it with <code>fetch</code>, so it has to " +
      "be served over HTTP: run <code>python3 -m http.server</code> in the project root and " +
      "open the address it prints.";
    console.error(error);
    return;
  }

  Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
  Chart.defaults.font.size = 12;

  const state = createState(() => render());
  state.hydrate(dataset);

  const ui = {
    masthead: createMasthead(dataset, el("masthead")),
    slicers: createSlicers(dataset, el("slicers"), state),
    breadcrumb: createBreadcrumb(dataset, el("breadcrumb"), state),
    kpis: createKpiStrip(dataset, el("kpis")),
    statement: createPnlStatement(dataset, el("pnl-statement"), state),
  };
  const charts = {
    phasing: createRevenuePhasing(dataset, el("chart-phasing")),
    bridge: createVarianceBridge(dataset, el("chart-bridge")),
    drivers: createDrivers(dataset, el("chart-drivers"), state),
    grossToNet: createGrossToNet(dataset, el("chart-g2n")),
    pvm: createPvmBridge(dataset, el("chart-pvm")),
    realisation: createRealisation(dataset, el("chart-realisation")),
    promo: createPromoReturn(dataset, el("chart-promo")),
    contribution: createContributionMap(dataset, el("chart-contribution"), state),
    share: createMarketShare(dataset, el("chart-share")),
  };

  buildViewSwitcher();
  buildPvmToggle();

  function render() {
    const started = performance.now();
    const current = state.get();

    const ctx = renderContext(dataset, current);
    ctx.ladder = ladder(dataset, ctx.filters);
    ctx.referenceLadder = ctx.referenceFilters ? ladder(dataset, ctx.referenceFilters) : null;
    ctx.netRevenue = ctx.ladder.value("net_revenue");

    ui.masthead.render(ctx);
    ui.slicers.render(ctx);
    ui.breadcrumb.render(ctx);
    syncViewSwitcher(current.view);
    for (const view of VIEWS) el(`view-${view.id}`).hidden = view.id !== current.view;

    el("kpis").hidden = current.view === "pnl";
    if (current.view !== "pnl") ui.kpis.render(ctx);

    switch (current.view) {
      case "performance": {
        charts.phasing.render(ctx);
        captionBridge(ctx, charts.bridge.render(ctx));
        captionDrivers(ctx, charts.drivers.render(ctx));
        break;
      }
      case "pnl":
        ui.statement.render(ctx);
        break;
      case "commercial": {
        captionGrossToNet(ctx, charts.grossToNet.render(ctx));
        syncPvmToggle(current.pvmSegment);
        captionPvm(ctx, charts.pvm.render(ctx));
        charts.realisation.render(ctx);
        captionPromo(ctx, charts.promo.render(ctx));
        break;
      }
      case "portfolio": {
        captionContribution(ctx, charts.contribution.render(ctx));
        captionShare(ctx, charts.share.render(ctx));
        break;
      }
      default:
        break;
    }

    const elapsed = performance.now() - started;
    // Measured at 16-40ms warm, ~80ms cold. Above this, look at aggregate.js.
    if (elapsed > 150) console.warn(`Render took ${elapsed.toFixed(0)}ms`);
  }

  // --- chrome -----------------------------------------------------------------

  function buildViewSwitcher() {
    el("views").replaceChildren(
      ...VIEWS.map((view) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "view-tab";
        button.dataset.view = view.id;
        button.textContent = view.label;
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

  function buildPvmToggle() {
    const root = el("pvm-segment");
    root.replaceChildren(
      ...[
        ["category", "by category"],
        ["customer", "by customer"],
      ].map(([id, label]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "segment";
        b.dataset.segment = id;
        b.textContent = label;
        b.addEventListener("click", () => state.set({ pvmSegment: id }));
        return b;
      })
    );
  }

  function syncPvmToggle(active) {
    for (const b of el("pvm-segment").querySelectorAll(".segment")) {
      b.setAttribute("aria-pressed", String(b.dataset.segment === active));
    }
  }

  // --- captions -----------------------------------------------------------------

  function captionBridge(ctx, result) {
    const target = dataset.structureRow(ctx.bridgeTarget).label;
    setText("title-bridge", `Why ${target} moved`);
    if (!result.available) {
      setText(
        "caption-bridge",
        result.reason === "no-compare"
          ? "Each bar will be one block of the P&L: how much it helped or hurt the result between the two scenarios."
          : "Not available at this grain: the overhead the bridge would walk through is not held per customer."
      );
      return;
    }
    const { bridge } = result;
    const scoped = ctx.scoped
      ? " Below group level the bridge stops at contribution margin, because the overhead is not there to walk through."
      : "";
    setText(
      "caption-bridge",
      `${SCENARIO_SHORT[ctx.compare]} ${money(bridge.start)} to ${SCENARIO_SHORT[ctx.primary]} ${money(
        bridge.end
      )}, a move of ${money(bridge.delta, { signed: true })}. Each bar is a change, not a level, and they sum to the difference exactly.${scoped}`
    );
    if (Math.abs(bridge.residual) > 1) console.error("Bridge does not tie", bridge.residual);
  }

  function captionDrivers(ctx, result) {
    if (!result.dimension) {
      setText("title-drivers", "Who is driving the gap");
      setText(
        "caption-drivers",
        result.reason === "no-compare"
          ? "Net revenue variance ranked by channel, then customer, then category. Click a bar to drill in."
          : "Every level of the hierarchy is already filtered. Step back up a level in the trail to break the gap down again."
      );
      return;
    }
    setText("title-drivers", `Which ${result.dimension} is driving the gap`);
    setText(
      "caption-drivers",
      `Net revenue against ${SCENARIO_SHORT[ctx.compare]} by ${result.dimension}, largest gap first. Click a bar to drill into it: every view refilters and the breakdown advances to the next level.`
    );
  }

  function captionGrossToNet(ctx, result) {
    let text = `${money(result.grossSales)} of gross sales becomes ${money(
      result.netRevenue
    )} of net revenue: ${percent(result.grossToNet)} is given back to the trade before it reaches the top line.`;
    if (ctx.referenceLadder) {
      const refG2N = 1 - ctx.referenceLadder.value("net_revenue") / ctx.referenceLadder.value("gross_sales");
      const diff = (result.grossToNet - refG2N) * 100;
      text += ` ${SCENARIO_SHORT[ctx.compare]} gave back ${percent(refG2N)}, so the ratio is ${
        Math.abs(diff) < 0.05 ? "unchanged" : `${diff > 0 ? "up" : "down"} ${Math.abs(diff).toFixed(1)} points`
      }.`;
    }
    setText("caption-g2n", text);
  }

  function captionPvm(ctx, result) {
    if (!result.available) {
      setText(
        "caption-pvm",
        "Splits the revenue movement into more cases, a different blend of them, a different list price and a different discount."
      );
      return;
    }
    const { bridge } = result;
    const biggest = [...bridge.steps].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
    setText(
      "caption-pvm",
      `Net revenue moved ${money(bridge.delta, { signed: true })} from ${SCENARIO_SHORT[ctx.compare]} to ${
        SCENARIO_SHORT[ctx.primary]
      }. The largest effect is ${biggest.label.toLowerCase()} at ${money(biggest.value, {
        signed: true,
      })}. Mix is measured across ${ctx.state.pvmSegment === "customer" ? "customers" : "categories"}; the four effects tie to the movement exactly.`
    );
    if (Math.abs(bridge.residual) > 1) console.error("PVM bridge does not tie", bridge.residual);
  }

  function captionPromo(ctx, result) {
    if (!result.points?.length) {
      setText("caption-promo", "Promotional pressure against promotional return, one bubble per category.");
      return;
    }
    const sorted = [...result.points].sort((a, b) => a.y - b.y);
    const worst = sorted[0];
    const best = sorted[sorted.length - 1];
    setText(
      "caption-promo",
      `Below the dashed line a promotion gives away more margin than it earns back. ${best.label} returns ${times(
        best.y
      )}x per promotional euro; ${worst.label} returns ${times(worst.y)}x on ${percent(
        worst.x / 100
      )} of its volume sold on deal. Bubble size is promotional spend.`
    );
  }

  function captionContribution(ctx, result) {
    setText(
      "caption-contribution",
      result.points
        ? `Every customer by net revenue and by what it keeps after cost of goods, marketing and cost to serve. The dashed line is the group's own ${percent(
            result.groupMargin
          )}: a customer below it is diluting the average however large it is. Click one to drill in.`
        : "No customers in this slice."
    );
  }

  function captionShare(ctx, result) {
    if (!result.available) {
      setText(
        "caption-share",
        ctx.scoped
          ? "Share is a category measure. Step back up to the whole group, or filter by category only, to read it."
          : "Volume share of each category market."
      );
      return;
    }
    setText(
      "caption-share",
      ctx.compare
        ? `Our share of each category market, ${SCENARIO_SHORT[ctx.primary]} against ${
            SCENARIO_SHORT[ctx.compare]
          }. The market is an independent series, so a lost point here is competitiveness, not a soft market.`
        : `Our share of each category market for ${SCENARIO_SHORT[ctx.primary]}. Turn on a comparison to see the movement.`
    );
  }

  // --- wiring -----------------------------------------------------------------

  window.addEventListener("hashchange", () => state.adoptHash());
  // The palette lives in CSS and follows the system theme, so the charts have
  // to be rebuilt to pick up the new values.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => render());

  status.remove();
  render();
}

start();
