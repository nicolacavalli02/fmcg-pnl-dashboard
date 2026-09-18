/**
 * Dashboard state: one object, one place, serialised into the URL.
 *
 * Every component reads from here and none of them holds a filter of its own,
 * which is what makes a slicer change or a drilldown click reach the whole
 * page at once. Nothing in this file knows about the DOM or about Chart.js,
 * and nothing touches `window` at import time, so the pure helpers can be
 * exercised from Node by the checks.
 *
 * Scenarios are modelled with two controls rather than three. `scenarios` is
 * the set the reader wants on screen; `compare` is the one they want measured
 * against, or null. The scenario being *read* -- the one KPIs, bridges and
 * variances are about -- is not chosen: it follows a fixed precedence,
 * Actual, then Forecast, then Budget, then Last Year. That is how anyone reads
 * a pack: if actuals are on the page you read the actuals. It covers every
 * pairing that makes sense (Actual vs Budget, Forecast vs Budget, Budget vs
 * LY) and rules out the ones that do not (reading the plan while the actuals
 * sit beside it) without asking the user a third question.
 */

/** Order the drivers chart drills through when it advances a level. */
export const HIERARCHY = ["channel", "customer", "category"];

/** Which scenario is read when several are shown. See the file comment. */
export const SCENARIO_PRECEDENCE = ["cy_actual", "forecast", "budget", "ly_actual"];

export const SCENARIO_SHORT = {
  cy_actual: "Actual",
  forecast: "Forecast",
  budget: "Budget",
  ly_actual: "Last year",
};

export const PERIODS = {
  ytd: { id: "ytd", label: "Year to date" },
  fy: { id: "fy", label: "Full year" },
};

export const VIEWS = ["performance", "pnl", "commercial", "portfolio"];

const DEFAULTS = {
  view: "performance",
  scenarios: ["cy_actual", "budget", "ly_actual", "forecast"],
  compare: "budget",
  period: "ytd",
  month: null, // 1..12; a single month overrides `period` when set
  channels: [],
  customers: [],
  categories: [],
  drill: [],
  // View-local preferences. Kept in state so a re-render preserves them, but
  // deliberately not in the URL: they describe how to look, not what at.
  pnlMode: "scenarios", // scenarios | months
  pnlCollapsed: [],
  pvmSegment: "category",
};

const LIST_KEYS = { ch: "channels", cu: "customers", ca: "categories" };

export function createState(onChange, { location = window.location, history = window.history } = {}) {
  let current = { ...DEFAULTS, ...fromHash(location.hash) };
  let silent = false;

  const notify = () => {
    if (silent) return;
    writeHash(current, location, history);
    onChange(current);
  };

  const api = {
    get: () => current,

    set(patch) {
      current = { ...current, ...patch };
      notify();
    },

    /** Replace a dimension's slicer selection. */
    setSelection(dimension, values) {
      const key = { channel: "channels", customer: "customers", category: "categories" }[dimension];
      current = { ...current, [key]: [...values] };
      notify();
    },

    /** Add or remove a scenario from the set on screen. Never empties it. */
    toggleScenario(id) {
      const has = current.scenarios.includes(id);
      if (has && current.scenarios.length === 1) return;
      const scenarios = has
        ? current.scenarios.filter((s) => s !== id)
        : [...current.scenarios, id];
      // A comparison against something no longer on screen is meaningless.
      const compare =
        current.compare && !scenarios.includes(current.compare) ? null : current.compare;
      current = { ...current, scenarios, compare };
      notify();
    },

    /** Choose what to measure against. Shows it if it was not on screen. */
    setCompare(id) {
      const scenarios =
        id && !current.scenarios.includes(id) ? [...current.scenarios, id] : current.scenarios;
      current = { ...current, scenarios, compare: id };
      notify();
    },

    /** Push a level onto the drill path. */
    drillInto(dimension, key, label) {
      if (current.drill.some((d) => d.dim === dimension && d.key === key)) return;
      current = { ...current, drill: [...current.drill, { dim: dimension, key, label }] };
      notify();
    },

    /** Cut the drill path back to `depth` entries. 0 returns to the top. */
    drillTo(depth) {
      current = { ...current, drill: current.drill.slice(0, depth) };
      notify();
    },

    /** Open or close a P&L group in the statement. */
    togglePnlGroup(id) {
      const pnlCollapsed = current.pnlCollapsed.includes(id)
        ? current.pnlCollapsed.filter((e) => e !== id)
        : [...current.pnlCollapsed, id];
      current = { ...current, pnlCollapsed };
      notify();
    },

    reset() {
      current = { ...DEFAULTS, view: current.view };
      notify();
    },

    /** Re-read the hash after a back/forward navigation. */
    adoptHash() {
      silent = true;
      current = { ...DEFAULTS, ...fromHash(location.hash) };
      silent = false;
      onChange(current);
    },

    /** Fill in the labels a hash cannot carry, once the dataset is known. */
    hydrate(dataset) {
      const drill = hydrateDrillLabels(dataset, current);
      if (drill.some((d, i) => d.label !== current.drill[i].label)) {
        current = { ...current, drill };
      }
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
// Deriving what the logic layer needs
// ---------------------------------------------------------------------------

/** The scenario read when these are on screen. */
export function primaryOf(scenarios) {
  return SCENARIO_PRECEDENCE.find((id) => scenarios.includes(id)) ?? scenarios[0] ?? null;
}

/** Months the current period covers. */
export function resolveMonths(dataset, state) {
  if (state.month) return [state.month];
  if (state.period === "fy") return dataset.months;
  return dataset.months.filter((m) => m <= dataset.lastClosedMonth);
}

/**
 * The scenarios to read, after the honest-period rule.
 *
 * Actuals stop at the close. If the selected period reaches into open months
 * while the actuals are on screen, the actual side becomes the Latest
 * Estimate -- which is what a full year "actual" means in practice: closed
 * months plus the current estimate. `substituted` lets the UI say so rather
 * than quietly relabelling the data.
 *
 * Returns { primary, compare, shown, substituted }. `shown` is ordered for
 * display: what is read first, what it is measured against second, context
 * after that.
 */
export function resolveBasis(dataset, state) {
  const valid = SCENARIO_PRECEDENCE.filter((id) => state.scenarios.includes(id));
  const months = resolveMonths(dataset, state);
  const reachesOpenMonths = months.some((m) => m > dataset.lastClosedMonth);

  let shown = valid.length ? valid : ["cy_actual"];
  let substituted = false;
  if (reachesOpenMonths && shown.includes("cy_actual")) {
    shown = [...new Set(shown.map((id) => (id === "cy_actual" ? "forecast" : id)))];
    substituted = true;
  }

  const primary = primaryOf(shown);
  const compare =
    state.compare && shown.includes(state.compare) && state.compare !== primary
      ? state.compare
      : null;

  const rest = shown.filter((id) => id !== primary && id !== compare);
  return {
    primary,
    compare,
    shown: [primary, ...(compare ? [compare] : []), ...rest],
    substituted,
    // Kept for readers that think in the old vocabulary.
    scenario: primary,
    against: compare,
  };
}

/** A drilled dimension narrows to exactly that member, overriding the slicer. */
function effective(state, dimension, selection) {
  const drilled = state.drill.filter((d) => d.dim === dimension).map((d) => d.key);
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
export function isCustomerScoped(state) {
  return Boolean(
    effective(state, "channel", state.channels).length ||
      effective(state, "customer", state.customers).length
  );
}

/** The dimension the drivers chart should break down next. */
export function nextDrillDimension(state) {
  const used = new Set(state.drill.map((d) => d.dim));
  return HIERARCHY.find((dim) => !used.has(dim)) ?? null;
}

/** Everything a render pass needs, computed once and handed to components. */
export function renderContext(dataset, state) {
  const basis = resolveBasis(dataset, state);
  const scoped = isCustomerScoped(state);
  return {
    state,
    basis,
    primary: basis.primary,
    compare: basis.compare,
    shown: basis.shown,
    months: resolveMonths(dataset, state),
    filters: toFilters(dataset, state, basis.primary),
    referenceFilters: basis.compare ? toFilters(dataset, state, basis.compare) : null,
    filtersFor: (scenario) => toFilters(dataset, state, scenario),
    scoped,
    drillDimension: nextDrillDimension(state),
    // Below contribution margin nothing survives a customer scope, so the
    // deepest subtotal a bridge can target moves with the filter.
    bridgeTarget: scoped ? "contribution_margin" : "ebitda",
  };
}

// ---------------------------------------------------------------------------
// URL hash
// ---------------------------------------------------------------------------

/**
 * Parse a hash into a partial state. Every value is checked against what the
 * page can actually show: a hand-edited or stale link degrades to the default
 * for that one key instead of blanking the page.
 */
export function fromHash(hash) {
  const raw = (hash ?? "").replace(/^#/, "");
  if (!raw) return {};
  const params = new URLSearchParams(raw);
  const out = {};

  if (VIEWS.includes(params.get("view"))) out.view = params.get("view");
  if (Object.keys(PERIODS).includes(params.get("p"))) out.period = params.get("p");

  const month = Number(params.get("m"));
  if (Number.isInteger(month) && month >= 1 && month <= 12) out.month = month;

  if (params.has("s")) {
    const scenarios = params.get("s").split(",").filter((id) => SCENARIO_PRECEDENCE.includes(id));
    if (scenarios.length) out.scenarios = scenarios;
  }
  if (params.has("c")) {
    const c = params.get("c");
    out.compare = SCENARIO_PRECEDENCE.includes(c) ? c : null;
  }
  for (const [short, full] of Object.entries(LIST_KEYS)) {
    if (params.has(short)) out[full] = params.get(short).split(",").filter(Boolean);
  }
  if (params.has("drill")) {
    out.drill = params
      .get("drill")
      .split("|")
      .filter(Boolean)
      .map((entry) => entry.split(":"))
      .filter(([dim, key]) => HIERARCHY.includes(dim) && key)
      .map(([dim, key]) => ({ dim, key, label: key }));
  }
  return out;
}

export function toHash(state) {
  const params = new URLSearchParams();
  if (state.view !== DEFAULTS.view) params.set("view", state.view);
  const sameScenarios =
    state.scenarios.length === DEFAULTS.scenarios.length &&
    DEFAULTS.scenarios.every((id) => state.scenarios.includes(id));
  if (!sameScenarios) params.set("s", state.scenarios.join(","));
  if (state.compare !== DEFAULTS.compare) params.set("c", state.compare ?? "none");
  if (state.period !== DEFAULTS.period) params.set("p", state.period);
  if (state.month) params.set("m", String(state.month));
  for (const [short, full] of Object.entries(LIST_KEYS)) {
    if (state[full].length) params.set(short, state[full].join(","));
  }
  if (state.drill.length) {
    params.set("drill", state.drill.map((d) => `${d.dim}:${d.key}`).join("|"));
  }
  return params.toString();
}

function writeHash(state, location, history) {
  const hash = toHash(state);
  const url = hash ? `#${hash}` : location.pathname + location.search;
  // replaceState, not a hash assignment: a slicer nudge is not a navigation
  // and should not fill the back button with intermediate states.
  history.replaceState(null, "", url);
}

/** Restore the labels a hash cannot carry, once the dataset is known. */
export function hydrateDrillLabels(dataset, state) {
  const lookup = {
    channel: (k) => dataset.channel(k)?.label,
    customer: (k) => dataset.customer(k)?.label,
    category: (k) => dataset.category(k)?.label,
  };
  return state.drill.map((entry) => ({
    ...entry,
    label: lookup[entry.dim]?.(entry.key) ?? entry.key,
  }));
}
