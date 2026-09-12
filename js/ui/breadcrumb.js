/**
 * The drill path, and what the page is currently reading.
 *
 * Two jobs. It shows where a drilldown has taken the reader and lets them
 * climb back out, and it states the scenario pair and period in words, so a
 * screenshot of this dashboard can never be ambiguous about what it is
 * comparing.
 */

import { periodLabel } from "./format.js";

export function createBreadcrumb(dataset, root, state) {
  return {
    render(ctx) {
      root.replaceChildren();

      const trail = document.createElement("nav");
      trail.className = "trail";
      trail.setAttribute("aria-label", "Drilldown path");

      const all = document.createElement("button");
      all.type = "button";
      all.className = "crumb";
      all.textContent = "All";
      all.disabled = ctx.state.drill.length === 0;
      all.addEventListener("click", () => state.drillTo(0));
      trail.append(all);

      ctx.state.drill.forEach((entry, i) => {
        const sep = document.createElement("span");
        sep.className = "crumb-sep";
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = "›";
        trail.append(sep);

        const crumb = document.createElement("button");
        crumb.type = "button";
        crumb.className = "crumb";
        crumb.textContent = entry.label;
        const isLast = i === ctx.state.drill.length - 1;
        crumb.disabled = isLast;
        if (isLast) crumb.classList.add("is-current");
        // Clicking a crumb returns to the level it names, which means keeping
        // everything up to and including it.
        crumb.addEventListener("click", () => state.drillTo(i + 1));
        trail.append(crumb);
      });

      root.append(trail);

      const reading = document.createElement("p");
      reading.className = "reading";
      const period = periodLabel(dataset, ctx.months);
      reading.append(
        document.createTextNode(
          `${dataset.scenario(ctx.basis.scenario).label} vs ` +
            `${dataset.scenario(ctx.basis.against).label} · ${period}`
        )
      );
      root.append(reading);

      if (ctx.basis.substituted) {
        // The reader asked for actuals over months that are not closed. We
        // give them the Latest Estimate, which is the only honest answer, and
        // we say so rather than relabelling the data.
        const note = document.createElement("p");
        note.className = "reading-note";
        note.textContent =
          `Actuals stop at ${
            dataset.meta.months[dataset.lastClosedMonth - 1].label
          }; the full year is read from the Latest Estimate.`;
        root.append(note);
      }

      if (ctx.scoped) {
        const note = document.createElement("p");
        note.className = "reading-note";
        note.textContent =
          "Filtered below group level: overhead, D&A and market size are not " +
          "held per customer, so EBITDA and share are unavailable here.";
        root.append(note);
      }
    },
  };
}
