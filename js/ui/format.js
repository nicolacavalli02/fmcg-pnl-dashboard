/**
 * Number and label formatting shared by every component.
 *
 * One rule runs through all of it: a value that is null is not a zero. Null
 * means the figure cannot be answered at the current grain -- EBITDA under a
 * customer filter, market share below category level -- and it renders as
 * "n/a", never as a number. Passing null into a formatter and getting "0.0m"
 * back would be the whole point of the logic layer thrown away at the last
 * step.
 *
 * Two families of formatter live here. The dashboard ones carry their unit
 * ("229.2m", "40.8%") because a tile stands alone. The ledger ones do not:
 * in a statement the unit is declared once in the heading, negatives sit in
 * parentheses, and a genuine zero is a dash -- the conventions a finance
 * reader has been reading since before screens.
 */

export const NOT_AVAILABLE = "n/a";

const isBlank = (value) =>
  value === null || value === undefined || Number.isNaN(value);

const fmt = (digits, signed = false) =>
  new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: signed ? "exceptZero" : "auto",
  });

const one = fmt(1);
const oneSigned = fmt(1, true);
const two = fmt(2);
const whole = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

// --- dashboard formatters ---------------------------------------------------

/** Millions, one decimal. `1.234m` */
export function money(value, { signed = false } = {}) {
  if (isBlank(value)) return NOT_AVAILABLE;
  return `${(signed ? oneSigned : one).format(value / 1e6)}m`;
}

/** A fraction as a percentage. `0.409` becomes `40.9%` */
export function percent(value, { signed = false } = {}) {
  if (isBlank(value)) return NOT_AVAILABLE;
  return `${(signed ? oneSigned : one).format(value * 100)}%`;
}

/** A difference between two ratios, in points. `0.016` becomes `+1.6pp` */
export function points(value) {
  if (isBlank(value)) return NOT_AVAILABLE;
  return `${oneSigned.format(value * 100)}pp`;
}

/** Cases, in millions when large enough to need it. */
export function cases(value) {
  if (isBlank(value)) return NOT_AVAILABLE;
  if (Math.abs(value) >= 1e6) return `${one.format(value / 1e6)}m`;
  return whole.format(value);
}

/** A plain ratio, such as promotional return. `0.82` */
export function times(value) {
  if (isBlank(value)) return NOT_AVAILABLE;
  return two.format(value);
}

/** Currency per case. `18.67` */
export function perCase(value) {
  if (isBlank(value)) return NOT_AVAILABLE;
  return two.format(value);
}

// --- ledger formatters ---------------------------------------------------------

/**
 * A statement figure in millions: no unit, negatives in parentheses, zero as
 * a dash. `-1234567` becomes `(1.2)`.
 */
export function ledger(value, digits = 1) {
  if (isBlank(value)) return NOT_AVAILABLE;
  const scaled = value / 1e6;
  if (Math.abs(scaled) < 0.05 / 10 ** (digits - 1)) return "–";
  const text = fmt(digits).format(Math.abs(scaled));
  return scaled < 0 ? `(${text})` : text;
}

/** A statement percentage: `40.9`, `(2.9)`. The % lives in the heading. */
export function ledgerPercent(value) {
  if (isBlank(value)) return NOT_AVAILABLE;
  const scaled = value * 100;
  if (Math.abs(scaled) < 0.05) return "–";
  const text = one.format(Math.abs(scaled));
  return scaled < 0 ? `(${text})` : text;
}

// --- helpers -----------------------------------------------------------------

/**
 * The class name that colours a variance.
 *
 * Driven by the `favourable` flag the logic layer already derived from the
 * line's sign, never by whether the number happens to be positive: a cost
 * coming in above plan is a bigger number and worse news.
 */
export function varianceClass(favourable) {
  if (favourable === null || favourable === undefined) return "is-flat";
  return favourable ? "is-favourable" : "is-adverse";
}

/** Read a CSS custom property, so colour stays defined in one place. */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** "January to August", "the full year", "March". */
export function periodPhrase(dataset, months) {
  if (!months.length) return "";
  const names = dataset.meta.months;
  if (months.length === 12) return "the full year";
  if (months.length === 1) return names[months[0] - 1].label;
  return `${names[months[0] - 1].label} to ${names[months[months.length - 1] - 1].label}`;
}

/** Compact "Jan–Aug 2026" for tight spaces. */
export function periodLabel(dataset, months) {
  if (!months.length) return "";
  const year = dataset.meta.current_year;
  const first = dataset.meta.months[months[0] - 1].short;
  if (months.length === 1) return `${first} ${year}`;
  if (months.length === 12) return `FY ${year}`;
  const last = dataset.meta.months[months[months.length - 1] - 1].short;
  return `${first}–${last} ${year}`;
}

/** Shade a hex colour towards the page by mixing in white (or black). */
export function tint(hex, amount, dark = false) {
  const n = parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n) || hex.length < 7) return hex;
  const channel = (shift) => {
    const c = (n >> shift) & 255;
    const target = dark ? 0 : 255;
    return Math.round(c + (target - c) * amount);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/** Download a text file from the page. */
export function downloadText(filename, text, type = "text/csv") {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
