/**
 * The drill path. Shows where a drilldown has taken the reader and lets them
 * climb back out. What the page is reading is said in the masthead; this bar
 * only says where in the business it is reading it.
 */

export function createBreadcrumb(dataset, root, state) {
  return {
    render(ctx) {
      root.replaceChildren();
      root.hidden = ctx.state.drill.length === 0;
      if (root.hidden) return;

      const trail = document.createElement("nav");
      trail.className = "trail";
      trail.setAttribute("aria-label", "Drilldown path");

      const lead = document.createElement("span");
      lead.className = "trail-lead";
      lead.textContent = "Drilled into";
      trail.append(lead);

      const all = document.createElement("button");
      all.type = "button";
      all.className = "crumb";
      all.textContent = "Whole group";
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
    },
  };
}
