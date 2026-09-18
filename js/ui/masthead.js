/**
 * The masthead: one sentence, generated from the state, that says exactly
 * what the page is showing.
 *
 * A management pack opens every page with a header block -- entity, period,
 * basis, currency -- and that block is what makes a photocopied page
 * self-explanatory a year later. This is the same device: whatever the
 * slicers say, the sentence says it in words, so no screenshot of this
 * dashboard can be ambiguous about what it compares, and a mismatch between
 * the sentence and a chart would be a bug you could read.
 */

import { SCENARIO_SHORT } from "../state.js";
import { periodPhrase } from "./format.js";

function scopePhrase(dataset, ctx) {
  const s = ctx.state;
  const parts = [];
  const names = (ids, lookup) => ids.map((id) => lookup(id)?.label ?? id);

  const channels = ctx.filters.channels;
  const customers = ctx.filters.customers;
  const categories = ctx.filters.categories;

  if (customers.length) parts.push(names(customers, dataset.customer).join(", "));
  else if (channels.length) parts.push(names(channels, dataset.channel).join(", "));
  if (categories.length) parts.push(names(categories, dataset.category).join(", "));

  if (!parts.length) return s.drill.length ? "" : "the whole group";
  return parts.join(" · ");
}

export function createMasthead(dataset, root) {
  const sentence = root.querySelector("[data-masthead-sentence]");
  const note = root.querySelector("[data-masthead-note]");

  return {
    render(ctx) {
      const year = dataset.meta.current_year;
      const read = `${SCENARIO_SHORT[ctx.primary]} ${
        ctx.primary === "ly_actual" ? dataset.meta.prior_year : year
      }`;
      const against = ctx.compare
        ? ` against ${SCENARIO_SHORT[ctx.compare]}${
            ctx.compare === "ly_actual" ? ` ${dataset.meta.prior_year}` : ""
          }`
        : ", no comparison";

      const period = periodPhrase(dataset, ctx.months);
      const scope = scopePhrase(dataset, ctx);

      // Rebuilt as spans so the changing parts can be emphasised without
      // rebuilding the whole sentence's markup by hand.
      sentence.replaceChildren(
        strong(read),
        text(against),
        text(", "),
        strong(period),
        text(scope ? ", " : ""),
        scope ? strong(scope) : text(""),
        text(". "),
        muted(`${dataset.meta.currency === "EUR" ? "€" : dataset.meta.currency} millions.`)
      );

      const notes = [];
      if (ctx.basis.substituted) {
        notes.push(
          `Actuals are closed through ${
            dataset.meta.months[dataset.lastClosedMonth - 1].label
          }; the months beyond are read from the Latest Estimate.`
        );
      }
      if (ctx.scoped) {
        notes.push(
          "Filtered below group level: overhead, D&A and market size are not held per customer, so EBITDA and share are unavailable here."
        );
      }
      note.textContent = notes.join(" ");
      note.hidden = notes.length === 0;
    },
  };
}

const text = (t) => document.createTextNode(t);
function strong(t) {
  const el = document.createElement("strong");
  el.textContent = t;
  return el;
}
function muted(t) {
  const el = document.createElement("span");
  el.className = "masthead-unit";
  el.textContent = t;
  return el;
}
