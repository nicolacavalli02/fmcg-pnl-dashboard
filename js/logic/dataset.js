/**
 * Dataset loading, indexing and dimension lookups.
 *
 * The raw JSON is a tidy fact table plus metadata describing the P&L ladder.
 * Nothing here interprets the numbers: this module only makes them fast to
 * reach and gives the rest of the logic layer a stable vocabulary. Every
 * module that computes a result builds on the object returned here.
 *
 * Note on serving: the dataset is fetched, so the page has to be served over
 * HTTP. Opening index.html straight from the filesystem will fail on CORS.
 *   python3 -m http.server
 */

const DEFAULT_URL = new URL("../../data/pnl_dataset.json", import.meta.url);

/**
 * Fetch and index the dataset. Returns the object every other module takes
 * as its first argument.
 */
export async function loadDataset(url = DEFAULT_URL) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Cannot load dataset: ${response.status} ${response.statusText}`
    );
  }
  return createDataset(await response.json());
}

/** Index an already parsed dataset. Split out so tests can skip the fetch. */
export function createDataset(raw) {
  const meta = raw.meta;
  const facts = raw.facts;

  const index = (list) => new Map(list.map((item) => [item.id, item]));
  const lines = index(meta.pnl_lines);
  const structure = index(meta.pnl_structure);
  const customers = index(meta.customers);
  const categories = index(meta.categories);
  const channels = index(meta.channels);
  const scenarios = index(meta.scenarios);

  // Facts bucketed by scenario. Every aggregation is scoped to a single
  // scenario, so this one split cuts each scan to a quarter of the table.
  const byScenario = new Map(meta.scenarios.map((s) => [s.id, []]));
  for (const fact of facts) byScenario.get(fact.scenario).push(fact);

  const customersByChannel = new Map(meta.channels.map((c) => [c.id, []]));
  for (const customer of meta.customers) {
    customersByChannel.get(customer.channel).push(customer);
  }

  // List prices live outside the fact table because a price is not additive:
  // summing one across months or categories is meaningless.
  const prices = new Map();
  for (const row of raw.price_list) {
    prices.set(`${row.scenario}|${row.category}|${row.month}`, row.list_price);
  }

  /**
   * Sign of a ladder row: +1 for income, -1 for cost. Groups inherit it from
   * their components, subtotals are profit measures and so always +1. Kept
   * as a derivation rather than stored in the data, so adding a line to a
   * group cannot leave a stale sign behind.
   */
  const signOf = (rowId) => {
    const leaf = lines.get(rowId);
    if (leaf) return leaf.sign;
    const row = structure.get(rowId);
    if (!row) return 1;
    if (row.type === "subtotal") return 1;
    const first = lines.get(row.components[0]);
    return first ? first.sign : 1;
  };

  const labelOf = (rowId) =>
    structure.get(rowId)?.label ?? lines.get(rowId)?.label ?? rowId;

  return Object.freeze({
    meta,
    facts,
    months: meta.months.map((m) => m.n),
    lastClosedMonth: meta.last_closed_month,

    factsFor: (scenarioId) => byScenario.get(scenarioId) ?? [],
    scenario: (id) => scenarios.get(id),
    scenarioIds: meta.scenarios.map((s) => s.id),
    line: (id) => lines.get(id),
    structureRow: (id) => structure.get(id),
    ladderRows: meta.pnl_structure,
    customer: (id) => customers.get(id),
    category: (id) => categories.get(id),
    channel: (id) => channels.get(id),
    customersOfChannel: (id) => customersByChannel.get(id) ?? [],
    listPrice: (scenarioId, categoryId, month) =>
      prices.get(`${scenarioId}|${categoryId}|${month}`),

    signOf,
    labelOf,

    /** Lines held per category only, with a null customer. */
    isUnallocated: (lineId) => lines.get(lineId)?.customer_level === false,
  });
}

/**
 * Members of a dimension, for building filter controls.
 * `dimension` is one of: customer, channel, category, area, month.
 */
export function dimensionMembers(dataset, dimension) {
  switch (dimension) {
    case "customer":
      return dataset.meta.customers.map((c) => ({ id: c.id, label: c.label }));
    case "channel":
      return dataset.meta.channels.map((c) => ({ id: c.id, label: c.label }));
    case "category":
      return dataset.meta.categories.map((c) => ({ id: c.id, label: c.label }));
    case "area":
      return dataset.meta.areas.map((a) => ({ id: a, label: a }));
    case "month":
      return dataset.meta.months.map((m) => ({ id: m.n, label: m.short }));
    default:
      throw new Error(`Unknown dimension: ${dimension}`);
  }
}

/** Which dimension a fact belongs to, for grouping. */
export function dimensionKey(dataset, fact, dimension) {
  switch (dimension) {
    case "customer":
      return fact.customer;
    case "category":
      return fact.category;
    case "month":
      return fact.month;
    case "channel":
      return dataset.customer(fact.customer)?.channel ?? null;
    case "area":
      return dataset.customer(fact.customer)?.area ?? null;
    default:
      throw new Error(`Unknown dimension: ${dimension}`);
  }
}
