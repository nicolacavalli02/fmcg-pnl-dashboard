/**
 * Page controller: load the dataset once, fill the context strip, draw the
 * charts. Anything that computes a figure belongs in /js/logic, anything
 * that draws belongs in /js/charts, and this file only wires the two to the
 * DOM.
 */

import { closedMonths, ladder, loadDataset, metrics } from "./logic/index.js";
import { renderRevenuePhasing } from "./charts/revenue-phasing.js";

const MILLION = 1e6;

const money = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const signed = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

const text = (id, value) => {
  document.getElementById(id).textContent = value;
};

function fillContext(dataset) {
  const ytd = { scenario: "cy_actual", months: closedMonths(dataset) };
  const kpi = metrics(dataset, ytd);
  const plan = ladder(dataset, { ...ytd, scenario: "budget" });
  const gap = kpi.netRevenue / plan.value("net_revenue") - 1;

  const lastMonth = dataset.meta.months[dataset.lastClosedMonth - 1].label;
  text("ctx-period", `Jan-${lastMonth.slice(0, 3)} ${dataset.meta.current_year}`);
  text("ctx-revenue", `${money.format(kpi.netRevenue / MILLION)}m`);
  text("ctx-gap", `${signed.format(gap * 100)}%`);
  text("ctx-margin", `${(kpi.grossMarginPct * 100).toFixed(1)}%`);

  // A miss against plan is coloured; hitting plan is not news and should not
  // shout. The threshold keeps rounding noise from tripping it.
  document
    .getElementById("ctx-gap")
    .classList.toggle("is-adverse", gap < -0.005);

  document.getElementById("closed-month").textContent = lastMonth;
}

function fillLegend(dataset, series) {
  const total = (values) =>
    values.reduce((sum, value) => sum + (value ?? 0), 0);

  const entries = [
    { id: "cy_actual", key: "actual", dashed: false },
    { id: "forecast", key: "forecast", dashed: true },
    { id: "budget", key: "budget", dashed: false },
    { id: "ly_actual", key: "ly", dashed: false },
  ];

  const list = document.getElementById("legend");
  list.replaceChildren(
    ...entries.map(({ id, key, dashed }) => {
      const item = document.createElement("li");

      const swatch = document.createElement("span");
      swatch.className = `swatch${dashed ? " is-dashed" : ""}`;
      swatch.style.borderTopColor = `var(--scenario-${
        id === "cy_actual" ? "actual" : id === "ly_actual" ? "ly" : id
      })`;
      item.append(swatch);

      const label = document.createElement("span");
      label.textContent = dataset.scenario(id).label;
      item.append(label);

      // Actual only covers closed months and forecast only open ones, so
      // their legend totals are partial by design and say so.
      const value = document.createElement("span");
      value.className = "legend-value";
      const suffix =
        key === "actual" ? " YTD" : key === "forecast" ? " Sep-Dec" : " FY";
      // The chart module already works in millions, so these totals are not
      // rescaled again here.
      const sum =
        key === "forecast"
          ? total(series.forecast.slice(dataset.lastClosedMonth))
          : total(series[key]);
      value.textContent = `${money.format(sum)}m${suffix}`;
      item.append(value);

      return item;
    })
  );
}

async function start() {
  const status = document.getElementById("status");
  try {
    const dataset = await loadDataset();
    fillContext(dataset);

    const canvas = document.getElementById("revenue-phasing");
    let rendered = renderRevenuePhasing(dataset, canvas);
    fillLegend(dataset, rendered.series);

    // The palette lives in CSS and changes with the system theme, so the
    // chart has to be rebuilt to pick the new values up.
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        rendered.chart.destroy();
        rendered = renderRevenuePhasing(dataset, canvas);
        fillLegend(dataset, rendered.series);
      });

    status.remove();
  } catch (error) {
    status.innerHTML =
      "Could not load the dataset. The page reads it with <code>fetch</code>, " +
      "so it has to be served over HTTP: run <code>python3 -m http.server</code> " +
      "in the project root and open the address it prints.";
    console.error(error);
  }
}

start();
