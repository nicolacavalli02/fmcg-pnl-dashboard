/**
 * The slicer bar.
 *
 * Two segmented controls for the things that have one answer at a time --
 * what we are comparing against, and over what period -- and three
 * multi-select dropdowns for the dimensions. Nothing here filters anything:
 * every control writes to the state, and the page re-renders from that.
 *
 * The customer list narrows to whatever channels are selected. Offering
 * eleven customers that the current channel filter would exclude is a menu
 * of dead ends.
 */

import { BASES, PERIODS } from "../state.js";

function segmented(legend, options, activeId, onPick) {
  const group = document.createElement("div");
  group.className = "slicer";

  const label = document.createElement("span");
  label.className = "slicer-label";
  label.textContent = legend;
  group.append(label);

  const control = document.createElement("div");
  control.className = "segmented";
  control.setAttribute("role", "group");
  control.setAttribute("aria-label", legend);

  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "segment";
    button.textContent = option.label;
    button.setAttribute("aria-pressed", String(option.id === activeId));
    button.addEventListener("click", () => onPick(option.id));
    control.append(button);
  }
  group.append(control);
  return group;
}

function multiSelect(legend, members, selected, onChange) {
  const group = document.createElement("div");
  group.className = "slicer";

  const label = document.createElement("span");
  label.className = "slicer-label";
  label.textContent = legend;
  group.append(label);

  const details = document.createElement("details");
  details.className = "picker";

  const summary = document.createElement("summary");
  summary.className = "picker-summary";
  summary.textContent = selected.length
    ? `${selected.length} selected`
    : "All";
  if (selected.length) summary.classList.add("is-active");
  details.append(summary);

  const panel = document.createElement("div");
  panel.className = "picker-panel";

  for (const member of members) {
    const row = document.createElement("label");
    row.className = "picker-option";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = selected.includes(member.id);
    box.addEventListener("change", () => {
      const next = box.checked
        ? [...selected, member.id]
        : selected.filter((id) => id !== member.id);
      onChange(next);
    });

    const text = document.createElement("span");
    text.textContent = member.label;
    row.append(box, text);
    panel.append(row);
  }

  if (selected.length) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "picker-clear";
    clear.textContent = "Clear";
    clear.addEventListener("click", () => onChange([]));
    panel.append(clear);
  }

  details.append(panel);
  group.append(details);
  return group;
}

export function createSlicers(dataset, root, state) {
  return {
    render(ctx) {
      const s = ctx.state;
      root.replaceChildren();

      root.append(
        segmented(
          "Comparison",
          Object.values(BASES),
          s.basis,
          (id) => state.set({ basis: id })
        )
      );

      const periodOptions = [
        ...Object.values(PERIODS),
        ...dataset.meta.months.map((m) => ({
          id: `m${m.n}`,
          label: m.short,
          month: m.n,
        })),
      ];
      const activePeriod = s.month ? `m${s.month}` : s.period;
      root.append(
        segmented("Period", periodOptions.slice(0, 2), activePeriod, (id) =>
          state.set({ period: id, month: null })
        )
      );

      // Channels first: the customer list depends on it.
      root.append(
        multiSelect(
          "Channel",
          dataset.meta.channels.map((c) => ({ id: c.id, label: c.label })),
          s.channels,
          (values) => state.setSelection("channel", values)
        )
      );

      const visibleCustomers = dataset.meta.customers
        .filter((c) => !s.channels.length || s.channels.includes(c.channel))
        .map((c) => ({ id: c.id, label: c.label }));
      root.append(
        multiSelect(
          "Customer",
          visibleCustomers,
          // A customer hidden by a channel change should not stay silently
          // selected: drop it so the label and the filter agree.
          s.customers.filter((id) =>
            visibleCustomers.some((c) => c.id === id)
          ),
          (values) => state.setSelection("customer", values)
        )
      );

      root.append(
        multiSelect(
          "Category",
          dataset.meta.categories.map((c) => ({ id: c.id, label: c.label })),
          s.categories,
          (values) => state.setSelection("category", values)
        )
      );

      const dirty =
        s.channels.length ||
        s.customers.length ||
        s.categories.length ||
        s.drill.length ||
        s.basis !== "actual_vs_budget" ||
        s.period !== "ytd";
      if (dirty) {
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "slicer-reset";
        reset.textContent = "Reset";
        reset.addEventListener("click", () => state.reset());
        root.append(reset);
      }
    },
  };
}
