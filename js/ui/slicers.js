/**
 * The control bar: which scenarios, measured against what, over which period,
 * for which slice of the business.
 *
 * Nothing here filters anything. Every control writes to the state and the
 * page re-renders from that. The one piece of local memory is which dropdown
 * is open: a re-render used to rebuild the <details> closed, so picking two
 * customers meant opening the menu twice. The open one is remembered across
 * renders and restored.
 *
 * The customer list narrows to whatever channels are selected. Offering
 * eleven customers that the current channel filter would exclude is a menu
 * of dead ends.
 */

import { PERIODS, SCENARIO_PRECEDENCE, SCENARIO_SHORT } from "../state.js";

function group(legend, control, extraClass = "") {
  const wrap = document.createElement("div");
  wrap.className = `slicer ${extraClass}`.trim();
  const label = document.createElement("span");
  label.className = "slicer-label";
  label.textContent = legend;
  wrap.append(label, control);
  return wrap;
}

function segmented(legend, options, activeId, onPick) {
  const control = document.createElement("div");
  control.className = "segmented";
  control.setAttribute("role", "group");
  control.setAttribute("aria-label", legend);
  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "segment";
    button.textContent = option.label;
    button.disabled = Boolean(option.disabled);
    if (option.title) button.title = option.title;
    button.setAttribute("aria-pressed", String(option.id === activeId));
    button.addEventListener("click", () => onPick(option.id));
    control.append(button);
  }
  return control;
}

export function createSlicers(dataset, root, state) {
  let openPicker = null;

  function multiSelect(legend, members, selected, onChange) {
    const details = document.createElement("details");
    details.className = "picker";
    details.open = openPicker === legend;
    details.addEventListener("toggle", () => {
      if (details.open) openPicker = legend;
      else if (openPicker === legend) openPicker = null;
    });

    const summary = document.createElement("summary");
    summary.className = "picker-summary";
    if (selected.length === 1) {
      summary.textContent = members.find((m) => m.id === selected[0])?.label ?? "1 selected";
    } else {
      summary.textContent = selected.length ? `${selected.length} selected` : "All";
    }
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
        onChange(
          box.checked ? [...selected, member.id] : selected.filter((id) => id !== member.id)
        );
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
    return group(legend, details);
  }

  // Close any open dropdown when the pointer lands elsewhere on the page.
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".picker")) {
      openPicker = null;
      for (const d of root.querySelectorAll("details.picker[open]")) d.open = false;
    }
  });

  return {
    render(ctx) {
      const s = ctx.state;
      root.replaceChildren();

      // --- scenarios on screen ------------------------------------------------
      const chips = document.createElement("div");
      chips.className = "chips";
      chips.setAttribute("role", "group");
      chips.setAttribute("aria-label", "Scenarios on screen");
      for (const id of SCENARIO_PRECEDENCE) {
        const on = s.scenarios.includes(id);
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `chip is-${id}`;
        chip.setAttribute("aria-pressed", String(on));
        chip.textContent = SCENARIO_SHORT[id];
        if (on && id === ctx.primary) {
          chip.classList.add("is-primary");
          chip.title = "The scenario being read";
        }
        if (on && s.scenarios.length === 1) chip.title = "At least one scenario stays on screen";
        chip.addEventListener("click", () => state.toggleScenario(id));
        chips.append(chip);
      }
      root.append(group("Scenarios", chips));

      // --- comparison ---------------------------------------------------------
      const compareOptions = [
        { id: null, label: "Off" },
        ...SCENARIO_PRECEDENCE.filter((id) => id !== ctx.primary).map((id) => ({
          id,
          label: SCENARIO_SHORT[id],
          title: s.scenarios.includes(id) ? undefined : `Adds ${SCENARIO_SHORT[id]} to the screen`,
        })),
      ];
      root.append(
        group(
          "Compare with",
          segmented("Compare with", compareOptions, ctx.compare, (id) => state.setCompare(id))
        )
      );

      // --- period -------------------------------------------------------------
      const period = document.createElement("div");
      period.className = "period-control";
      period.append(
        segmented(
          "Period",
          Object.values(PERIODS),
          s.month ? null : s.period,
          (id) => state.set({ period: id, month: null })
        )
      );
      const monthPick = document.createElement("select");
      monthPick.className = "month-select";
      monthPick.setAttribute("aria-label", "Single month");
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Month…";
      monthPick.append(placeholder);
      for (const m of dataset.meta.months) {
        const option = document.createElement("option");
        option.value = String(m.n);
        option.textContent = m.short + (m.n > dataset.lastClosedMonth ? " (est.)" : "");
        monthPick.append(option);
      }
      monthPick.value = s.month ? String(s.month) : "";
      if (s.month) monthPick.classList.add("is-active");
      monthPick.addEventListener("change", () =>
        state.set({ month: monthPick.value ? Number(monthPick.value) : null })
      );
      period.append(monthPick);
      root.append(group("Period", period));

      // --- dimensions ---------------------------------------------------------
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
          s.customers.filter((id) => visibleCustomers.some((c) => c.id === id)),
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
        s.month ||
        s.compare !== "budget" ||
        s.period !== "ytd" ||
        s.scenarios.length !== 4;
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
