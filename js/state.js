/**
 * Dashboard state: one object, one place, serialised into the URL.
 *
 * Every component reads from here and none of them holds a filter of its own,
 * which is what makes a slicer change or a drilldown click reach the whole
 * page at once. Nothing in this file knows about the DOM or about Chart.js.
 *
 * The state also encodes the honest-period rule described below: an actual
 * figure for a month the business has not closed does not exist, so asking
 * for one silently switches the reading to the Latest Estimate and says so.
 */

/** Order the drivers chart drills through when it advances a level. */
export const HIERARCHY = ["channel", "customer", "category"];

/**
 * The comparison bases. One control drives scenario and reference everywhere,
 * so no chart can end up comparing against something the header does not
 * claim.
 */
export const BASES = {
  actual_vs_budget: {
    id: "actual_vs_budget",
    label: "Actual vs Budget",
    scenario: "cy_actual",
    against: "budget",
  },
  actual_vs_ly: {
    id: "actual_vs_ly",
    label: "Actual vs LY",
    scenario: "cy_actual",
    against: "ly_actual",
  },
  forecast_vs_budget: {
    id: "forecast_vs_budget",
    label: "Forecast vs Budget",
    scenario: "forecast",
    against: "budget",
  },
};

export const PERIODS = {
  ytd: { id: "ytd", label: "Year to date" },
  fy: { id: "fy", label: "Full year" },
};

const DEFAULTS = {
  view: "performance",
  basis: "actual_vs_budget",
  period: "ytd",
  month: null, // a single month overrides `period` when set
  channels: [],
  customers: [],
  categories: [],
  drill: [],
  expanded: [], // P&L groups opened in the table; deliberately not in the URL
};

export function createState(onChange) {
  let current = { ...DEFAULTS, ...fromHash() };
  let silent = false;

  const notify = () => {
    if (silent) return;
    toHash(current);
    onChange(current);
  };

  return {
    get: () => current,

    set(patch) {
      current = { ...current, ...patch };
      notify();
    },

    /** Replace a dimension's slicer selection. */
    setSelection(dimension, values) {
      const key = { channel: "channels", customer: "customers",
                    category: "categories" }[dimension];
      current = { ...current, [key]: [...values] };
      notify();
    },

    /** Push a level onto the drill path. */
    drillInto(dimension, key, label) {
      if (current.drill.some((d) => d.dim === dimension && d.key === key)) {
        return;
      }
      current = {
        ...current,
        drill: [...current.drill, { dim: dimension, key, label }],
      };
      notify();
    },

    /** Cut the drill path back to `depth` entries. 0 returns to the top. */
    drillTo(depth) {
      current = { ...current, drill: current.drill.slice(0, depth) };
      notify();
    },

    toggleExpanded(id) {
      const expanded = current.expanded.includes(id)
        ? current.expanded.filter((e) => e !== id)
        : [...current.expanded, id];
      current = { ...current, expanded };
      notify();
    },

    reset() {
      current = { ...DEFAULTS, view: current.view };
      notify();
    },

    /** Re-read the hash after a back/forward navigation. */
    adoptHash() {
      silent = true;
      current = { ...DEFAULTS, ...fromHash() };
      silent = false;
      onChange(current);
    },
  };
}

// ---------------------------------------------------------------------------
// Deriving what the logic layer needs
// ---------------------------------------------------------------------------

/** Months the current period covers. */
export function resolveMonths(dataset, state) {
  if (state.month) return [Number(state.month)];
  if (state.period === "fy") return dataset.months;
  return dataset.months.filter((m) => m <= dataset.lastClosedMonth);
}

/**
 * The scenario pair to read, after the honest-period rule.
 *
 * Actuals stop at the close. If the selected period reaches into open months
 * while the basis asks for actuals, the actual side becomes the Latest
 * Estimate -- which is what a full year "actual" means in practice: closed
 * months plus the current estimate. `substituted` lets the UI say so rather
 * than quietly relabelling the data.
 */
export function resolveBasis(dataset, state) {
  const base = BASES[state.basis] ?? BASES.actual_vs_budget;
  const months = resolveMonths(dataset, state);
  const reachesOpenMonths = months.some((m) => m > dataset.lastClosedMonth);

  if (reachesOpenMonths && base.scenario === "cy_actual") {
    return { ...base, scenario: "forecast", substituted: true };
  }
  return { ...base, substituted: false };
}

/** A drilled dimension narrows to exactly that member, overriding the slicer. */
function effective(state, dimension, selection) {
  const drilled = state.drill
    .filter((d) => d.dim === dimension)
    .map((d) => d.key);
  return drilled.length ? drilled : selection;
}

/** Build the filter object the logic layer takes, for one scenario. */
export function toFilters(dataset, state, scenario) {
  return {
    scenario,
    months: resolveMonths(dataset, state),
    channels: effective(state, "channel", state.channels),
    customers: effective(state, "customer", state.customers),
    categories: effective(state, "category", state.categories),
  };
}

/**
 * True when the view is narrowed below group level, so the unallocated lines
 * -- overhead, D&A, market size -- are out of reach. Mirrors the rule in
 * aggregate.js rather than guessing at it.
 */
export function isCustomerScoped(dataset, state) {
  const f = toFilters(dataset, state, "cy_actual");
  return Boolean(f.channels.length || f.customers.length);
}

/** The dimension the drivers chart should break down next. */
export function nextDrillDimension(state) {
  const used = new Set(state.drill.map((d) => d.dim));
  return HIERARCHY.find((dim) => !used.has(dim)) ?? null;
}

/** Everything a render pass needs, computed once and handed to components. */
export function renderContext(dataset, state) {
  const basis = resolveBasis(dataset, state);
  const months = resolveMonths(dataset, state);
  return {
    state,
    basis,
    months,
    filters: toFilters(dataset, state, basis.scenario),
    referenceFilters: toFilters(dataset, state, basis.against),
    scoped: isCustomerScoped(dataset, state),
    drillDimension: nextDrillDimension(state),
    // Below contribution margin nothing survives a customer scope, so the
    // deepest subtotal a bridge can target moves with the filter.
    bridgeTarget: isCustomerScoped(dataset, state)
      ? "contribution_margin"
      : "ebitda",
  };
}

// ---------------------------------------------------------------------------
// URL hash
// ---------------------------------------------------------------------------

const LIST_KEYS = { ch: "channels", cu: "customers", ca: "categories" };

function fromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return {};
  const params = new URLSearchParams(hash);
  const out = {};

  for (const key of ["view", "basis", "period"]) {
    if (params.has(key)) out[key] = params.get(key);
  }
  if (params.has("month")) out.month = Number(params.get("month"));
  for (const [short, full] of Object.entries(LIST_KEYS)) {
    if (params.has(short)) out[full] = params.get(short).split(",").filter(Boolean);
  }
  if (params.has("drill")) {
    out.drill = params
      .get("drill")
      .split("|")
      .filter(Boolean)
      .map((entry) => {
        const [dim, key] = entry.split(":");
        return { dim, key, label: key };
      });
  }
  return out;
}

function toHash(state) {
  const params = new URLSearchParams();
  if (state.view !== DEFAULTS.view) params.set("view", state.view);
  if (state.basis !== DEFAULTS.basis) params.set("basis", state.basis);
  if (state.period !== DEFAULTS.period) params.set("period", state.period);
  if (state.month) params.set("month", String(state.month));
  for (const [short, full] of Object.entries(LIST_KEYS)) {
    if (state[full].length) params.set(short, state[full].join(","));
  }
  if (state.drill.length) {
    params.set("drill", state.drill.map((d) => `${d.dim}:${d.key}`).join("|"));
  }
  const hash = params.toString();
  const url = hash ? `#${hash}` : window.location.pathname;
  // replaceState, not a hash assignment: a slicer nudge is not a navigation
  // and should not fill the back button with intermediate states.
  window.history.replaceState(null, "", url);
}

/** Restore the labels a hash cannot carry, once the dataset is known. */
export function hydrateDrillLabels(dataset, state) {
  return state.drill.map((entry) => {
    const lookup = {
      channel: (k) => dataset.channel(k)?.label,
      customer: (k) => dataset.customer(k)?.label,
      category: (k) => dataset.category(k)?.label,
    }[entry.dim];
    return { ...entry, label: lookup?.(entry.key) ?? entry.key };
  });
}
