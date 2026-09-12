/**
 * Filtering, aggregation and resolution of the P&L ladder.
 *
 * The fact table holds only leaf lines as positive magnitudes. Every
 * subtotal -- net revenue, gross profit, contribution margin, EBITDA, EBIT --
 * is computed here from `meta.pnl_structure`, so the shape of the P&L lives
 * in the data and never gets hardcoded into a chart.
 *
 * The one subtlety worth knowing: the customer P&L stops at contribution
 * margin. G&A, R&D and D&A are held per category with a null customer, so as
 * soon as a filter narrows to a customer, a channel or an area, those lines
 * are not merely zero, they are unavailable. Rows that depend on them are
 * marked unavailable too, rather than being silently computed as if the
 * overhead were nil -- which would quietly report EBITDA equal to
 * contribution margin.
 */

import { dimensionKey } from "./dataset.js";

/**
 * Normalise a filter object.
 * @param {object} filters
 * @param {string} filters.scenario   required scenario id
 * @param {number[]|{from:number,to:number}} [filters.months]
 * @param {string[]} [filters.customers]
 * @param {string[]} [filters.channels]
 * @param {string[]} [filters.areas]
 * @param {string[]} [filters.categories]
 */
export function normaliseFilters(filters) {
  if (!filters || !filters.scenario) {
    throw new Error("A scenario is required to aggregate");
  }
  const toSet = (value) =>
    value && value.length ? new Set(value) : null;

  let months = null;
  if (Array.isArray(filters.months)) {
    months = new Set(filters.months);
  } else if (filters.months && typeof filters.months === "object") {
    months = new Set();
    for (let m = filters.months.from; m <= filters.months.to; m += 1) {
      months.add(m);
    }
  }

  const customers = toSet(filters.customers);
  const channels = toSet(filters.channels);
  const areas = toSet(filters.areas);

  return {
    scenario: filters.scenario,
    months,
    customers,
    channels,
    areas,
    categories: toSet(filters.categories),
    // Any of these three narrows the view to a subset of customers, which is
    // what makes the unallocated lines meaningless.
    customerScoped: Boolean(customers || channels || areas),
  };
}

/** Does one fact survive the filter? Filters must be normalised first. */
export function factMatches(dataset, fact, f) {
  if (f.months && !f.months.has(fact.month)) return false;
  if (f.categories && !f.categories.has(fact.category)) return false;

  if (fact.customer === null) {
    // Unallocated lines belong to no customer, so any customer-side filter
    // excludes them rather than matching them by accident.
    return !f.customerScoped;
  }
  if (f.customers && !f.customers.has(fact.customer)) return false;
  if (f.channels || f.areas) {
    const customer = dataset.customer(fact.customer);
    if (f.channels && !f.channels.has(customer.channel)) return false;
    if (f.areas && !f.areas.has(customer.area)) return false;
  }
  return true;
}

/**
 * Scan memo.
 *
 * A single dashboard render asks for the same totals several times over: the
 * KPI tiles, the bridge and the P&L table all want the current scenario under
 * the current filter, and each one was paying for its own full scan. Measured
 * before adding this, a render spent about 45ms in aggregation and roughly a
 * third of it was recomputing identical answers.
 *
 * The dataset is immutable once indexed, so a cached total can never go
 * stale. Keyed per dataset through a WeakMap so a discarded dataset takes its
 * cache with it, and capped so a long session cannot grow it without bound.
 */
const MEMO_LIMIT = 240;
const memos = new WeakMap();

function memo(dataset, key, compute) {
  let cache = memos.get(dataset);
  if (!cache) {
    cache = new Map();
    memos.set(dataset, cache);
  }
  if (cache.has(key)) return cache.get(key);
  const value = compute();
  // Cheapest useful eviction: once full, start again. Filter combinations
  // arrive in bursts per render, so a cold cache refills in one pass.
  if (cache.size >= MEMO_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}

/** Stable signature of a normalised filter, for the memo key. */
function signature(f) {
  const list = (set) => (set ? [...set].sort().join(",") : "*");
  return [
    f.scenario,
    list(f.months),
    list(f.customers),
    list(f.channels),
    list(f.areas),
    list(f.categories),
  ].join("|");
}

/**
 * Total every leaf line under a filter. Returns Map<lineId, number>.
 *
 * The returned map is shared with other callers through the memo, so treat it
 * as read-only. Everything downstream copies it before touching it:
 * resolveLadder builds its own map from these totals.
 */
export function aggregate(dataset, filters) {
  const f = normaliseFilters(filters);
  return memo(dataset, `t:${signature(f)}`, () => {
    const totals = new Map();
    for (const fact of dataset.factsFor(f.scenario)) {
      if (!factMatches(dataset, fact, f)) continue;
      totals.set(fact.line, (totals.get(fact.line) ?? 0) + fact.value);
    }
    return totals;
  });
}

/**
 * Total every leaf line, split by one dimension, in a single pass.
 * Returns Map<memberKey, Map<lineId, number>>. Unallocated facts land under
 * the key null when the dimension cannot describe them.
 */
export function aggregateBy(dataset, filters, dimension) {
  const f = normaliseFilters(filters);
  return memo(dataset, `b:${dimension}:${signature(f)}`, () => {
    const buckets = new Map();
    for (const fact of dataset.factsFor(f.scenario)) {
      if (!factMatches(dataset, fact, f)) continue;
      const key = dimensionKey(dataset, fact, dimension);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = new Map();
        buckets.set(key, bucket);
      }
      bucket.set(fact.line, (bucket.get(fact.line) ?? 0) + fact.value);
    }
    return buckets;
  });
}

/**
 * Resolve the ladder from leaf totals.
 *
 * @param {boolean} customerScoped whether unallocated rows are out of reach
 * @returns {{rows: object[], get: function, value: function, leaf: Map}}
 */
export function resolveLadder(dataset, leafTotals, customerScoped = false) {
  const values = new Map(leafTotals);
  const available = new Map();
  for (const line of dataset.meta.pnl_lines) {
    available.set(line.id, !customerScoped || line.customer_level);
  }

  const rows = [];
  for (const row of dataset.ladderRows) {
    const refs =
      row.type === "group"
        ? row.components
        : row.formula.map(([, ref]) => ref);
    // A row survives only if the data underneath it does. Without this, a
    // customer filtered view would report EBITDA as if overhead were zero.
    const isAvailable =
      (row.customer_level || !customerScoped) &&
      refs.every((ref) => available.get(ref) !== false);

    let value = 0;
    if (row.type === "group") {
      for (const component of row.components) {
        value += values.get(component) ?? 0;
      }
    } else {
      for (const [op, ref] of row.formula) {
        value += (values.get(ref) ?? 0) * (op === "+" ? 1 : -1);
      }
    }

    values.set(row.id, value);
    available.set(row.id, isAvailable);
    rows.push({
      id: row.id,
      label: row.label,
      type: row.type,
      emphasis: row.emphasis,
      sign: dataset.signOf(row.id),
      value: isAvailable ? value : null,
      available: isAvailable,
    });
  }

  const netRevenue = values.get("net_revenue") ?? 0;
  for (const row of rows) {
    // Every line of a P&L is read as a share of net revenue, so carry it
    // alongside rather than making each chart recompute it.
    row.shareOfNetRevenue =
      row.available && netRevenue !== 0 ? row.value / netRevenue : null;
  }

  return {
    rows,
    leaf: values,
    customerScoped,
    get: (id) => rows.find((row) => row.id === id),
    value: (id) => (available.get(id) === false ? null : values.get(id) ?? 0),
  };
}

/**
 * Turn a resolved ladder into cumulative waterfall steps.
 *
 * Walks the structure from the top down to `to`, carrying a running balance
 * so each cost line is a float hanging off the one before it, and each
 * subtotal is a bar standing on zero. This is the arithmetic a gross-to-net
 * or a P&L waterfall needs, and it lives here so two chart modules cannot
 * drift into two slightly different versions of it.
 *
 * `detail` decides whether a multi-line group is broken into its components
 * (the point of a gross-to-net chart) or shown as one bar.
 */
export function ladderWaterfall(
  dataset,
  resolved,
  { to = "net_revenue", detail = true } = {}
) {
  const steps = [];
  let running = 0;

  for (const row of dataset.ladderRows) {
    if (row.type === "group") {
      const parts = detail ? row.components : [row.id];
      for (const id of parts) {
        const value = resolved.value(id) ?? 0;
        const sign = dataset.signOf(id);
        const delta = sign * value;
        steps.push({
          id,
          label: dataset.labelOf(id),
          sign,
          value,
          delta,
          start: running,
          end: running + delta,
          // The opening bar stands on zero like a subtotal: it is a level,
          // not a movement.
          isTotal: steps.length === 0,
        });
        running += delta;
      }
    } else {
      const value = resolved.value(row.id);
      steps.push({
        id: row.id,
        label: row.label,
        sign: 1,
        value,
        delta: null,
        start: 0,
        end: running,
        isTotal: true,
        // Should be zero: the running balance has to land on the subtotal the
        // ladder itself reports. Exposed so a chart can prove it ties.
        residual: value === null ? null : value - running,
      });
    }
    if (row.id === to) break;
  }
  return steps;
}

/** Aggregate and resolve in one call: the usual entry point. */
export function ladder(dataset, filters) {
  const f = normaliseFilters(filters);
  return resolveLadder(dataset, aggregate(dataset, filters), f.customerScoped);
}

/**
 * One ladder per member of a dimension, sorted by the given row descending.
 * `dimension` is customer, channel, category, area or month.
 */
export function ladderBy(dataset, filters, dimension, { sortBy = null } = {}) {
  const f = normaliseFilters(filters);
  // Splitting by customer, channel or area is itself a customer scoping:
  // each bucket holds a subset of customers and so cannot carry overhead.
  const bucketScoped =
    f.customerScoped || ["customer", "channel", "area"].includes(dimension);

  const results = [];
  for (const [key, totals] of aggregateBy(dataset, filters, dimension)) {
    if (key === null) continue;
    results.push({
      key,
      label: labelFor(dataset, dimension, key),
      ladder: resolveLadder(dataset, totals, bucketScoped),
    });
  }
  if (sortBy) {
    results.sort(
      (a, b) => (b.ladder.value(sortBy) ?? 0) - (a.ladder.value(sortBy) ?? 0)
    );
  }
  return results;
}

/** Monthly series for one ladder row. Always returns all twelve months. */
export function monthlySeries(dataset, filters, rowId) {
  const byMonth = new Map(
    ladderBy(dataset, filters, "month").map((entry) => [
      entry.key,
      entry.ladder,
    ])
  );
  return dataset.months.map((month) => ({
    month,
    label: dataset.meta.months[month - 1].short,
    value: byMonth.get(month)?.value(rowId) ?? 0,
  }));
}

/** Running total of a ladder row through the year. */
export function cumulativeSeries(dataset, filters, rowId) {
  let running = 0;
  return monthlySeries(dataset, filters, rowId).map((point) => {
    running += point.value ?? 0;
    return { ...point, value: running };
  });
}

function labelFor(dataset, dimension, key) {
  switch (dimension) {
    case "customer":
      return dataset.customer(key)?.label ?? key;
    case "channel":
      return dataset.channel(key)?.label ?? key;
    case "category":
      return dataset.category(key)?.label ?? key;
    case "month":
      return dataset.meta.months[key - 1].short;
    default:
      return String(key);
  }
}

/** Months already closed, the honest default for an actual-vs-plan read. */
export function closedMonths(dataset) {
  return dataset.months.filter((m) => m <= dataset.lastClosedMonth);
}

/** Months still open, which only the forecast can speak to. */
export function openMonths(dataset) {
  return dataset.months.filter((m) => m > dataset.lastClosedMonth);
}
