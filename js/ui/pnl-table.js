/**
 * The P&L ladder as a table.
 *
 * The backbone of the page: a finance reader wants the numbers before the
 * pictures. Group rows carrying more than one line can be opened to show
 * their components, which is the structural half of drilling down -- the
 * dimensional half lives in the drivers chart.
 *
 * Rows the current filter cannot answer are rendered as unavailable rather
 * than as zero. Under a customer filter that means everything below
 * contribution margin, and the table says why instead of quietly showing
 * EBITDA equal to the line above it.
 */

import { compareLadders } from "../logic/index.js";
import {
  money,
  NOT_AVAILABLE,
  percent,
  points,
  varianceClass,
} from "./format.js";

const INDENT = { group: "", subtotal: "" };

export function createPnlTable(dataset, root, state) {
  return {
    render(ctx) {
      const rows = compareLadders(dataset, ctx.filters, {
        against: ctx.basis.against,
      });

      const table = document.createElement("table");
      table.className = "pnl";

      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const [label, cls] of [
        ["", "col-line"],
        [dataset.scenario(ctx.basis.scenario).label, "num"],
        [dataset.scenario(ctx.basis.against).label, "num"],
        ["Variance", "num"],
        ["Var %", "num"],
        ["% of net revenue", "num"],
      ]) {
        const th = document.createElement("th");
        th.textContent = label;
        th.className = cls;
        headRow.append(th);
      }
      head.append(headRow);
      table.append(head);

      const body = document.createElement("tbody");

      for (const row of rows) {
        const structure = dataset.structureRow(row.id);
        const expandable =
          structure.type === "group" && structure.components.length > 1;
        const open = ctx.state.expanded.includes(row.id);

        body.append(
          buildRow({
            dataset,
            ctx,
            state,
            id: row.id,
            label: row.label,
            emphasis: row.emphasis,
            type: row.type,
            available: row.available,
            actual: row.actual,
            reference: row.reference,
            delta: row.delta,
            deltaPct: row.deltaPct,
            favourable: row.favourable,
            sharePoints: row.shareVariance.points,
            share:
              row.available && ctx.netRevenue
                ? row.actual / ctx.netRevenue
                : null,
            expandable,
            open,
          })
        );

        if (expandable && open) {
          for (const lineId of structure.components) {
            const line = dataset.line(lineId);
            const actual = ctx.ladder.value(lineId);
            const reference = ctx.referenceLadder.value(lineId);
            const available = actual !== null && reference !== null;
            const delta = available ? actual - reference : null;
            body.append(
              buildRow({
                dataset,
                ctx,
                state,
                id: lineId,
                label: line.label,
                emphasis: "detail",
                type: "leaf",
                available,
                actual,
                reference,
                delta,
                deltaPct:
                  available && reference ? delta / Math.abs(reference) : null,
                favourable:
                  delta === null || delta === 0
                    ? null
                    : line.sign > 0
                      ? delta > 0
                      : delta < 0,
                sharePoints: null,
                share:
                  available && ctx.netRevenue ? actual / ctx.netRevenue : null,
                expandable: false,
                open: false,
              })
            );
          }
        }
      }

      table.append(body);
      root.replaceChildren(table);
    },
  };
}

function buildRow(opts) {
  const tr = document.createElement("tr");
  tr.className = `pnl-row is-${opts.emphasis}`;
  if (!opts.available) tr.classList.add("is-unavailable");

  const label = document.createElement("th");
  label.scope = "row";
  label.className = "col-line";

  if (opts.expandable) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "disclose";
    toggle.setAttribute("aria-expanded", String(opts.open));
    toggle.textContent = opts.open ? "−" : "+";
    toggle.addEventListener("click", () => opts.state.toggleExpanded(opts.id));
    label.append(toggle);
  }

  const text = document.createElement("span");
  text.textContent = opts.label;
  label.append(text);
  tr.append(label);

  const cell = (content, className = "") => {
    const td = document.createElement("td");
    td.className = `num ${className}`.trim();
    td.textContent = content;
    return td;
  };

  if (!opts.available) {
    tr.append(cell(NOT_AVAILABLE), cell(NOT_AVAILABLE), cell(""), cell(""), cell(""));
    tr.title =
      "Not held at this grain: overhead, D&A and market size exist per " +
      "category only, so a customer or channel filter cannot reach them.";
    return tr;
  }

  tr.append(
    cell(money(opts.actual)),
    cell(money(opts.reference)),
    cell(money(opts.delta, { signed: true }), varianceClass(opts.favourable)),
    cell(
      percent(opts.deltaPct, { signed: true }),
      varianceClass(opts.favourable)
    ),
    cell(opts.share === null ? "" : percent(opts.share))
  );
  return tr;
}
