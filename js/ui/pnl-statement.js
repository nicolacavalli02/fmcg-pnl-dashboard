/**
 * The P&L as a statement.
 *
 * Two readings of the same ladder. By scenario: one column per scenario on
 * screen, with the variance against the comparison sitting right after the
 * column it measures. By month: the primary scenario across the year, with
 * a year-to-date and a full-year total -- and, when the primary is the
 * actual, the open months read from the Latest Estimate and marked as such,
 * because an actual figure for an unclosed month does not exist.
 *
 * Set in ledger convention: the unit is declared once in the heading,
 * negatives sit in parentheses, a genuine zero is a dash, a single rule sits
 * above each subtotal and a double rule closes the statement. Rows the
 * current filter cannot answer render as unavailable rather than as zero.
 */

import { ladder, ladderBy, variance } from "../logic/index.js";
import { SCENARIO_SHORT } from "../state.js";
import {
  downloadText,
  ledger,
  ledgerPercent,
  NOT_AVAILABLE,
  varianceClass,
} from "./format.js";

export function createPnlStatement(dataset, root, state) {
  return {
    render(ctx) {
      const mode = ctx.state.pnlMode;
      const spec = rowSpec(dataset, ctx.state.pnlCollapsed);
      const matrix =
        mode === "months" ? byMonth(dataset, ctx, spec) : byScenario(dataset, ctx, spec);

      root.replaceChildren(
        toolbar(ctx, state, matrix, spec),
        table(dataset, ctx, state, spec, matrix)
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function rowSpec(dataset, collapsed) {
  const rows = [];
  const last = dataset.ladderRows[dataset.ladderRows.length - 1].id;
  for (const row of dataset.ladderRows) {
    const multi = row.type === "group" && row.components.length > 1;
    const open = !collapsed.includes(row.id);
    rows.push({
      id: row.id,
      label: row.label,
      kind: row.type === "subtotal" ? "subtotal" : "group",
      closing: row.id === last,
      expandable: multi,
      open,
      sign: dataset.signOf(row.id),
    });
    if (multi && open) {
      for (const lineId of row.components) {
        rows.push({
          id: lineId,
          label: dataset.line(lineId).label,
          kind: "leaf",
          sign: dataset.line(lineId).sign,
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Matrices: columns + a cell reader
// ---------------------------------------------------------------------------

function byScenario(dataset, ctx, spec) {
  const ladders = new Map(ctx.shown.map((id) => [id, ladder(dataset, ctx.filtersFor(id))]));
  const primary = ladders.get(ctx.primary);
  const reference = ctx.compare ? ladders.get(ctx.compare) : null;
  const netRevenue = primary.value("net_revenue");

  const columns = [];
  for (const id of ctx.shown) {
    columns.push({
      key: id,
      label: dataset.scenario(id).label,
      kind: "value",
      cell: (row) => ({ value: ladders.get(id).value(row.id), text: ledger(ladders.get(id).value(row.id)) }),
    });
    if (id === ctx.compare) {
      columns.push({
        key: "delta",
        label: `Δ vs ${SCENARIO_SHORT[ctx.compare]}`,
        kind: "variance",
        cell: (row) => {
          const v = variance(primary.value(row.id), reference.value(row.id), row.sign);
          return { value: v.delta, text: ledger(v.delta), tone: v.favourable };
        },
      });
      columns.push({
        key: "deltaPct",
        label: "Δ %",
        kind: "variance",
        cell: (row) => {
          const v = variance(primary.value(row.id), reference.value(row.id), row.sign);
          return { value: v.deltaPct, text: ledgerPercent(v.deltaPct), tone: v.favourable };
        },
      });
    }
  }
  columns.push({
    key: "share",
    label: "% of net rev.",
    kind: "share",
    cell: (row) => {
      const v = primary.value(row.id);
      const share = v === null || !netRevenue ? null : v / netRevenue;
      return { value: share, text: ledgerPercent(share) };
    },
  });

  return {
    mode: "scenarios",
    columns,
    legend: null,
    title: `${dataset.scenario(ctx.primary).label}${
      ctx.compare ? ` against ${dataset.scenario(ctx.compare).label}` : ""
    }`,
  };
}

function byMonth(dataset, ctx, spec) {
  // The month view ignores the period slicer by definition: it is the period.
  const { months, scenario, ...dimensional } = ctx.filters;
  const closed = dataset.lastClosedMonth;
  const usesEstimate = ctx.primary === "cy_actual" || ctx.basis.substituted;
  const actualId = ctx.primary === "forecast" && ctx.basis.substituted ? "cy_actual" : ctx.primary;

  const perMonth = new Map(
    ladderBy(dataset, { ...dimensional, scenario: actualId }, "month").map((e) => [e.key, e.ladder])
  );
  const estimate = usesEstimate
    ? new Map(ladderBy(dataset, { ...dimensional, scenario: "forecast" }, "month").map((e) => [e.key, e.ladder]))
    : null;

  const ytd = ladder(dataset, {
    ...dimensional,
    scenario: actualId,
    months: dataset.months.filter((m) => m <= closed),
  });
  const fullYear = ladder(dataset, {
    ...dimensional,
    scenario: usesEstimate ? "forecast" : actualId,
  });

  const columns = dataset.meta.months.map((m) => {
    const isEstimate = usesEstimate && m.n > closed;
    const source = isEstimate ? estimate : perMonth;
    return {
      key: `m${m.n}`,
      label: m.short,
      kind: isEstimate ? "estimate" : "value",
      cell: (row) => {
        const v = source.get(m.n)?.value(row.id) ?? null;
        return { value: v, text: ledger(v) };
      },
    };
  });
  columns.push({
    key: "ytd",
    label: `YTD ${dataset.meta.months[closed - 1].short}`,
    kind: "total",
    cell: (row) => ({ value: ytd.value(row.id), text: ledger(ytd.value(row.id)) }),
  });
  columns.push({
    key: "fy",
    label: usesEstimate ? "FY estimate" : "Full year",
    kind: "total",
    cell: (row) => ({ value: fullYear.value(row.id), text: ledger(fullYear.value(row.id)) }),
  });

  return {
    mode: "months",
    columns,
    legend: usesEstimate
      ? `${dataset.meta.months[closed].short}–${dataset.meta.months[11].short} are read from the Latest Estimate; the full year is closed months plus that estimate.`
      : null,
    title: `${dataset.scenario(actualId).label} by month`,
  };
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

function toolbar(ctx, state, matrix, spec) {
  const bar = document.createElement("div");
  bar.className = "statement-bar";

  const heading = document.createElement("div");
  heading.className = "statement-heading";
  const h = document.createElement("h2");
  h.textContent = matrix.title;
  const unit = document.createElement("p");
  unit.className = "statement-unit";
  unit.textContent = "€ millions · negatives in parentheses";
  heading.append(h, unit);
  bar.append(heading);

  const controls = document.createElement("div");
  controls.className = "statement-controls";

  const modes = document.createElement("div");
  modes.className = "segmented";
  modes.setAttribute("role", "group");
  modes.setAttribute("aria-label", "Statement layout");
  for (const [id, label] of [["scenarios", "By scenario"], ["months", "By month"]]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "segment";
    b.textContent = label;
    b.setAttribute("aria-pressed", String(ctx.state.pnlMode === id));
    b.addEventListener("click", () => state.set({ pnlMode: id }));
    modes.append(b);
  }
  controls.append(modes);

  const csv = document.createElement("button");
  csv.type = "button";
  csv.className = "button-quiet";
  csv.textContent = "Download CSV";
  csv.addEventListener("click", () =>
    downloadText(csvName(ctx, matrix), csvText(matrix, spec))
  );
  controls.append(csv);

  bar.append(controls);
  return bar;
}

function table(dataset, ctx, state, spec, matrix) {
  const frame = document.createElement("div");
  frame.className = "table-frame";

  const table = document.createElement("table");
  table.className = `statement is-${matrix.mode}`;

  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "col-line";
  corner.scope = "col";
  hr.append(corner);
  for (const col of matrix.columns) {
    const th = document.createElement("th");
    th.scope = "col";
    th.className = `num is-${col.kind}`;
    th.textContent = col.label;
    hr.append(th);
  }
  thead.append(hr);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const row of spec) {
    const tr = document.createElement("tr");
    tr.className = `srow is-${row.kind}`;
    if (row.closing) tr.classList.add("is-closing");

    const th = document.createElement("th");
    th.scope = "row";
    th.className = "col-line";
    if (row.expandable) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "disclose";
      toggle.setAttribute("aria-expanded", String(row.open));
      toggle.setAttribute("aria-label", `${row.open ? "Collapse" : "Expand"} ${row.label}`);
      toggle.textContent = row.open ? "−" : "+";
      toggle.addEventListener("click", () => state.togglePnlGroup(row.id));
      th.append(toggle);
    }
    const label = document.createElement("span");
    label.textContent = row.label;
    th.append(label);
    tr.append(th);

    let unavailable = false;
    for (const col of matrix.columns) {
      const { text, tone } = col.cell(row);
      const td = document.createElement("td");
      td.className = `num is-${col.kind}`;
      td.textContent = text;
      if (text === NOT_AVAILABLE) unavailable = true;
      if (col.kind === "variance" && tone !== undefined) td.classList.add(varianceClass(tone));
      tr.append(td);
    }
    if (unavailable) {
      tr.classList.add("is-unavailable");
      tr.title =
        "Not held at this grain: overhead, D&A and market size exist per category only, so a customer or channel filter cannot reach them.";
    }
    tbody.append(tr);
  }
  table.append(tbody);
  frame.append(table);

  if (matrix.legend) {
    const legend = document.createElement("p");
    legend.className = "statement-legend";
    legend.textContent = matrix.legend;
    frame.append(legend);
  }
  return frame;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** The rendered matrix as CSV: values in millions, ratios in percent. */
function csvText(matrix, spec) {
  const rows = [["Line", ...matrix.columns.map((c) => c.label)]];
  for (const row of spec) {
    rows.push([
      row.kind === "leaf" ? `  ${row.label}` : row.label,
      ...matrix.columns.map((c) => {
        const { value } = c.cell(row);
        if (value === null || value === undefined) return "";
        return c.kind === "share" || c.key === "deltaPct"
          ? (value * 100).toFixed(2)
          : (value / 1e6).toFixed(3);
      }),
    ]);
  }
  return rows.map((r) => r.map(escapeCsv).join(",")).join("\n");
}

function escapeCsv(value) {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvName(ctx, matrix) {
  const scope = ctx.state.drill.map((d) => d.key).join("-") || "group";
  return `pnl-${matrix.mode}-${ctx.primary}-${scope}.csv`;
}
